const Exporter = require('./base');
const client = require('prom-client');

class PrometheusExporter extends Exporter {
  constructor(aggregator, options = {}) {
    super(options);
    if (!aggregator) throw new Error('PrometheusExporter requires aggregator');
    this.aggregator = aggregator;
    this.registry = options.registry || client.register;
    this.metrics = {};
    // create metrics
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
    // register a collect function
    this.registry.registerMetric(this.metrics.request_count);
    // we will update metrics on collect
    client.collectDefaultMetrics({ register: this.registry });
    // hook into registry collect — update our gauges before scrape
    const self = this;
    this._collector = async () => {
      try {
        const snap = self.aggregator.snapshot();
        // reset metrics by removing all values then set per item
        // prom-client gauge.set with labels overrides previous
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
    // prom-client v14+ supports register.registerCollector — but to be compatible, use collectDefaultMetrics and update metrics on interval
    this._interval = setInterval(() => {
      this._collector();
    }, options.collectIntervalMs || 1000);
  }

  // return an express-style handler for /metrics that uses registry.metrics()
  metricsEndpoint() {
    const registry = this.registry;
    return async (_req, res) => {
      try {
        // ensure latest
        await this._collector();
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

