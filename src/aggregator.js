// Simple metrics aggregator (gateway-neutral). Uses histogram buckets to approximate percentiles.
class Aggregator {
  constructor(options = {}) {
    this.buckets = Array.isArray(options.buckets)
      ? options.buckets.slice()
      : [0.5, 2, 5, 10, 50, 100, 200, 500, 1000, 2000, 5000]; // ms
    // ensure sorted ascending
    this.buckets.sort((a, b) => a - b);
    this.apdexT = typeof options.apdexT === 'number' ? options.apdexT : 200; // ms
    // Map key -> aggregation object
    this.data = new Map();
    this.maxCardinality = options.maxCardinality || 2000;
    this.tenant = options.tenant || undefined;
    this.version = options.version || undefined;
  }

  _labelsKey(labels) {
    // stable key ordering
    const parts = [
      labels.service || 'unknown',
      labels.env || 'unknown',
      labels.method || 'GET',
      labels.route || 'unknown',
      String(labels.statusClass || '0'),
      labels.tenant || this.tenant || '',
      labels.version || this.version || '',
    ];
    return parts.join('|');
  }

  _makeEmpty(labels) {
    return {
      labels,
      count: 0,
      sum: 0,
      buckets: new Array(this.buckets.length).fill(0),
      bucketInf: 0, // > last bucket
      errorCount: 0,
      apdex: { satisfied: 0, tolerating: 0, frustrated: 0 },
      lastSeen: Date.now(),
    };
  }

  handle(event) {
    try {
      const labels = {
        service: event.service,
        env: event.env,
        method: event.method,
        route: event.route,
        statusClass: event.statusClass,
        tenant: event.tenant,
        version: event.version,
      };

      const key = this._labelsKey(labels);
      if (!this.data.has(key)) {
        if (this.data.size >= this.maxCardinality) {
          // cardinality protection: drop
          return;
        }
        this.data.set(key, this._makeEmpty(labels));
      }

      const agg = this.data.get(key);
      agg.count += 1;
      const d = Number(event.durationMs) || 0;
      agg.sum += d;
      agg.lastSeen = Date.now();

      // bucket
      let placed = false;
      for (let i = 0; i < this.buckets.length; i++) {
        if (d <= this.buckets[i]) {
          agg.buckets[i] += 1;
          placed = true;
          break;
        }
      }
      if (!placed) agg.bucketInf += 1;

      // errors
      if (event.status >= 400) agg.errorCount += 1;

      // apdex
      if (d <= this.apdexT) agg.apdex.satisfied += 1;
      else if (d <= 4 * this.apdexT) agg.apdex.tolerating += 1;
      else agg.apdex.frustrated += 1;
    } catch (e) {
      // swallow
    }
  }

  _computePercentiles(agg, percentiles = [0.5, 0.9, 0.95, 0.99]) {
    const results = {};
    const total = agg.count;
    if (total === 0) {
      percentiles.forEach((p) => (results['p' + Math.round(p * 100)] = 0));
      return results;
    }

    // build cumulative counts
    const counts = agg.buckets.slice();
    counts.push(agg.bucketInf);
    const buckets = this.buckets.slice();
    buckets.push(Infinity);
    const cumulative = [];
    let sum = 0;
    for (let c of counts) {
      sum += c;
      cumulative.push(sum);
    }

    percentiles.forEach((p) => {
      const target = total * p;
      let idx = cumulative.findIndex((v) => v >= target);
      if (idx === -1) idx = cumulative.length - 1;
      // approximate percentile as bucket upper bound
      results['p' + Math.round(p * 100)] =
        buckets[idx] === Infinity ? buckets[buckets.length - 2] : buckets[idx];
    });
    return results;
  }

  snapshot(monitor) {
    const out = [];
    for (const [key, agg] of this.data.entries()) {
      const labels = agg.labels;
      const p = this._computePercentiles(agg);
      const avg = agg.count ? agg.sum / agg.count : 0;
      const apdexDen = agg.count || 1;
      const apdexScore =
        (agg.apdex.satisfied + agg.apdex.tolerating / 2) / apdexDen;

      out.push({
        labels,
        request_count: agg.count,
        request_duration_ms: {
          sum: agg.sum,
          avg,
          ...p,
          buckets: agg.buckets.slice(),
          bucketInf: agg.bucketInf,
        },
        error_count: agg.errorCount,
        in_flight_requests: monitor && typeof monitor.getInFlight === 'function' ? monitor.getInFlight() : 0,
        apdex: {
          t: this.apdexT,
          score: Number(apdexScore.toFixed(3)),
          satisfied: agg.apdex.satisfied,
          tolerating: agg.apdex.tolerating,
          frustrated: agg.apdex.frustrated,
        },
        lastSeen: agg.lastSeen,
      });
    }
    return out;
  }

  metricsEndpoint(monitor) {
    return (_req, res) => {
      res.json({ metrics: this.snapshot(monitor) });
    };
  }

  // very small Prometheus exposition (text/plain)
  promEndpoint(monitor, opts = {}) {
    const escapeLabel = (v) =>
      String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    return (_req, res) => {
      const lines = [];
      // metrics: request_count, request_duration_ms_sum, request_duration_ms_count, error_count, in_flight_requests, apdex_score
      const snap = this.snapshot(monitor);
      // Build metrics
      for (const item of snap) {
        const l = item.labels;
        const labels = `service="${escapeLabel(l.service)}",env="${escapeLabel(l.env)}",method="${escapeLabel(
          l.method
        )}",route="${escapeLabel(l.route)}",status_class="${escapeLabel(l.statusClass)}"`;

        lines.push(`# TYPE request_count counter`);
        lines.push(`request_count{${labels}} ${item.request_count}`);
        lines.push(`# TYPE request_duration_ms_sum gauge`);
        lines.push(`request_duration_ms_sum{${labels}} ${item.request_duration_ms.sum}`);
        lines.push(`# TYPE request_duration_ms_avg gauge`);
        lines.push(`request_duration_ms_avg{${labels}} ${item.request_duration_ms.avg}`);
        lines.push(`# TYPE error_count counter`);
        lines.push(`error_count{${labels}} ${item.error_count}`);
        lines.push(`# TYPE in_flight_requests gauge`);
        lines.push(`in_flight_requests{${labels}} ${item.in_flight_requests}`);
        lines.push(`# TYPE apdex_score gauge`);
        lines.push(`apdex_score{${labels}} ${item.apdex.score}`);
        // percentiles as gauges
        lines.push(`# TYPE request_duration_ms_p50 gauge`);
        lines.push(`request_duration_ms_p50{${labels}} ${item.request_duration_ms.p50}`);
        lines.push(`# TYPE request_duration_ms_p90 gauge`);
        lines.push(`request_duration_ms_p90{${labels}} ${item.request_duration_ms.p90}`);
        lines.push(`# TYPE request_duration_ms_p95 gauge`);
        lines.push(`request_duration_ms_p95{${labels}} ${item.request_duration_ms.p95}`);
        lines.push(`# TYPE request_duration_ms_p99 gauge`);
        lines.push(`request_duration_ms_p99{${labels}} ${item.request_duration_ms.p99}`);
      }

      res.setHeader('Content-Type', 'text/plain; version=0.0.4');
      res.send(lines.join('\n') + '\n');
    };
  }
}

module.exports = { Aggregator };

