const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const path = require('path');

const { Aggregator } = require(path.join(__dirname, '..', 'src', 'aggregator.js'));
const PrometheusExporter = require(path.join(__dirname, '..', 'src', 'exporter', 'prometheus.js'));

describe('Prometheus Exporter', function () {
  it('exposes metrics including apm_request_count', async function () {
    const agg = new Aggregator({ apdexT: 100 });
    // feed a request
    agg.handle({
      service: 'svc',
      env: 'test',
      method: 'GET',
      route: '/r',
      statusClass: 200,
      status: 200,
      durationMs: 50,
    });

    const prom = new PrometheusExporter(agg, { collectIntervalMs: 50 });
    const app = express();
    app.get('/metrics', prom.metricsEndpoint());

    const res = await request(app).get('/metrics').expect(200);
    const text = res.text || '';
    expect(text).to.be.a('string');
    expect(text).to.match(/apm_request_count/);
  });
});

