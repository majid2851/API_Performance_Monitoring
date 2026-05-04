const { expect } = require('chai');
const { Aggregator } = require('../src/aggregator');

describe('Aggregator', function () {
  it('buckets durations and computes counts and percentiles', function () {
    const agg = new Aggregator({ buckets: [10, 50, 100, 500], apdexT: 100 });
    const labels = {
      service: 'svc',
      env: 'test',
      method: 'GET',
      route: '/r',
      statusClass: 200,
    };

    // Feed synthetic events with durations in ms
    const durations = [5, 8, 12, 20, 35, 60, 120, 300, 800];
    durations.forEach((d) => {
      agg.handle({
        service: labels.service,
        env: labels.env,
        method: labels.method,
        route: labels.route,
        statusClass: labels.statusClass,
        status: 200,
        durationMs: d,
      });
    });

    const snap = agg.snapshot();
    expect(snap).to.be.an('array').with.lengthOf(1);
    const item = snap[0];
    expect(item.request_count).to.equal(durations.length);
    expect(item.error_count).to.equal(0);
    // percentiles should be present
    expect(item.request_duration_ms).to.have.property('p50');
    expect(item.request_duration_ms).to.have.property('p90');
    expect(item.apdex).to.have.property('score');
  });
});

