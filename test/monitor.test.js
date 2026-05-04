const { expect } = require('chai');
const request = require('supertest');
const express = require('express');
const path = require('path');

const { expressAdapter } = require(path.join(__dirname, '..', 'src', 'index.js'));
const { Aggregator } = require(path.join(__dirname, '..', 'src', 'aggregator.js'));

describe('Monitor middleware integration', function () {
  it('emits request events and aggregator collects metrics', async function () {
    const { monitor, middleware, route } = expressAdapter({
      service: 'test-service',
      env: 'test',
      sampling: 1,
    });

    const agg = new Aggregator({ apdexT: 100 });
    monitor.on('request', (evt) => agg.handle(evt));

    const app = express();
    app.use(middleware());
    app.get('/foo/:id', route('/foo/:id'), (req, res) => {
      res.status(200).json({ id: req.params.id });
    });

    // Make several requests
    await request(app).get('/foo/1').expect(200);
    await request(app).get('/foo/2').expect(200);
    await request(app).get('/foo/3').expect(200);

    // Allow asynchronous emits to be processed
    await new Promise((r) => setTimeout(r, 50));

    const snap = agg.snapshot(monitor);
    expect(snap).to.be.an('array').that.is.not.empty;
    const item = snap.find((s) => s.labels.route === '/foo/:id');
    expect(item).to.exist;
    expect(item.request_count).to.equal(3);
    expect(item.error_count).to.equal(0);
    expect(item.in_flight_requests).to.be.a('number').that.equals(0);
    expect(item.apdex).to.have.property('score');
  });
});

