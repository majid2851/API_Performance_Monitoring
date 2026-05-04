const { expect } = require('chai');
const { createMonitor } = require('../src/monitor');
const { Pipeline } = require('../src/exporter/pipeline');

describe('Monitor flush/shutdown', function () {
  it('flush sends queued events to exporter', async function () {
    const monitor = createMonitor({ service: 'svc', env: 'test', sampling: 1 });
    const pipeline = new Pipeline({ batchSize: 100, batchIntervalMs: 10000 });
    const received = [];
    const mockExporter = {
      start: () => {},
      exportBatch: async (batch) => {
        received.push(batch.slice());
      },
      shutdown: async () => {},
    };
    pipeline.registerExporter(mockExporter);
    pipeline.attachMonitor(monitor);

    monitor.emit('request', { service: 'svc', env: 'test', method: 'GET', route: '/r', status: 200, statusClass: 200, durationMs: 10 });

    // flush and wait
    await monitor.flush(2000);
    expect(received.length).to.be.at.least(1);
  });
});

