const path = require('path');
const express = require('express');
const { expressAdapter } = require(path.join(__dirname, '..', 'src', 'index.js'));

const app = express();
const port = Number(process.env.PORT) || 3000;

const { monitor, middleware, route } = expressAdapter({
  service: 'demo-api',
  env: process.env.NODE_ENV || 'development',
  sampling: 1,
});

app.use(middleware());

monitor.on('request', (evt) => {
  console.log(
    `[APM] ${evt.method} ${evt.route} ${evt.status} ${evt.durationMs.toFixed(2)}ms`
  );
});
// attach aggregator
const { Aggregator } = require(path.join(__dirname, '..', 'src', 'aggregator.js'));
const agg = new Aggregator({ apdexT: 200 });
monitor.on('request', (evt) => agg.handle(evt));

app.get('/metrics', agg.metricsEndpoint(monitor));
app.get('/metrics/prom', agg.promEndpoint(monitor));
// attach pipeline + exporters demo
const { Pipeline } = require(path.join(__dirname, '..', 'src', 'exporter', 'pipeline.js'));
const WebhookExporter = require(path.join(__dirname, '..', 'src', 'exporter', 'webhook.js'));
const PrometheusExporter = require(path.join(__dirname, '..', 'src', 'exporter', 'prometheus.js'));

const pipeline = new Pipeline({ batchSize: 10, batchIntervalMs: 2000 });
// attach monitor -> pipeline
pipeline.attachMonitor(monitor);

// demo webhook exporter (no-op URL by default, only register if env provided)
if (process.env.WEBHOOK_URL) {
  const wh = new WebhookExporter({ url: process.env.WEBHOOK_URL, retries: 2 });
  pipeline.registerExporter(wh);
}

// demo Prometheus exporter using aggregator; expose at /metrics/client
const promExp = new PrometheusExporter(agg, { collectIntervalMs: 2000 });
app.get('/metrics/client', promExp.metricsEndpoint());

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'API Performance Monitoring demo' });
});

app.get('/users/:id', route('/users/:id'), (req, res) => {
  res.json({ userId: req.params.id });
});

app.listen(port, () => {
  console.log(`Demo server listening on http://localhost:${port}`);
});
