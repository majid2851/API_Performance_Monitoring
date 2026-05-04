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

app.get('/', (_req, res) => {
  res.json({ ok: true, message: 'API Performance Monitoring demo' });
});

app.get('/users/:id', route('/users/:id'), (req, res) => {
  res.json({ userId: req.params.id });
});

app.listen(port, () => {
  console.log(`Demo server listening on http://localhost:${port}`);
});
