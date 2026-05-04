const Exporter = require('./base');

let client = null;
try {
  client = require('prom-client');
} catch (e) {
  client = null;
}

class PrometheusExporter extends Exporter {
  constructor(aggregator, options = {}) {
    super(options);
    if (!aggregator) throw new Error('PrometheusExporter requires aggregator');
    this.aggregator = aggregator;
    this._usesPromClient = !!client;
    if (!this._usesPromClient) {
      // prom-client not available — fallback to aggregator's promEndpoint
      return;
    }

    this.registry = options.registry || client.register;
    this.metrics = {};
    // create metrics (Gauges reflect current snapshot)
    this.metrics.request_count = new client.Gauge({
      name: 'apm_request_count',
      help: 'Request count',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.request_duration_ms_p50 = new client.Gauge({
      name: 'apm_request_duration_ms_p50',
      help: 'Request duration p50 ms',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.request_duration_ms_p90 = new client.Gauge({
      name: 'apm_request_duration_ms_p90',
      help: 'Request duration p90 ms',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.request_duration_ms_p95 = new client.Gauge({
      name: 'apm_request_duration_ms_p95',
      help: 'Request duration p95 ms',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.request_duration_ms_p99 = new client.Gauge({
      name: 'apm_request_duration_ms_p99',
      help: 'Request duration p99 ms',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.error_count = new client.Gauge({
      name: 'apm_error_count',
      help: 'Error count',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });
    this.metrics.apdex_score = new client.Gauge({
      name: 'apm_apdex_score',
      help: 'Apdex score',
      labelNames: ['service', 'env', 'method', 'route', 'status_class'],
      registers: [this.registry],
    });

    // update metrics periodically from aggregator snapshot
    const self = this;
    this._collector = async () => {
      try {
        const snap = self.aggregator.snapshot();
        for (const item of snap) {
          const l = item.labels || {};
          const labels = {
            service: l.service || '',
            env: l.env || '',
            method: l.method || '',
            route: l.route || '',
            status_class: String(l.statusClass || ''),
          };
          self.metrics.request_count.set(labels, item.request_count);
          self.metrics.request_duration_ms_p50.set(labels, item.request_duration_ms.p50 || 0);
          self.metrics.request_duration_ms_p90.set(labels, item.request_duration_ms.p90 || 0);
          self.metrics.request_duration_ms_p95.set(labels, item.request_duration_ms.p95 || 0);
          self.metrics.request_duration_ms_p99.set(labels, item.request_duration_ms.p99 || 0);
          self.metrics.error_count.set(labels, item.error_count || 0);
          self.metrics.apdex_score.set(labels, item.apdex.score || 0);
        }
      } catch (e) {
        // ignore
      }
    };
    this.registry.setDefaultLabels({ app: options.appName || 'apm' });
    this._interval = setInterval(() => {
      this._collector();
    }, options.collectIntervalMs || 1000);
  }

  // return an express-style handler for /metrics that uses registry.metrics()
  metricsEndpoint() {
    if (!this._usesPromClient) {
      // fallback: reuse aggregator's promEndpoint (text exposition) without prom-client
      return this.aggregator.promEndpoint(null);
    }

    const registry = this.registry;
    const self = this;
    return async (_req, res) => {
      try {
        // ensure latest
        await self._collector();
        res.setHeader('Content-Type', registry.contentType);
        res.end(await registry.metrics());
      } catch (e) {
        res.statusCode = 500;
        res.end('error');
      }
    };
  }

  async shutdown() {
    if (this._interval) clearInterval(this._interval);
  }
}

module.exports = PrometheusExporter;

