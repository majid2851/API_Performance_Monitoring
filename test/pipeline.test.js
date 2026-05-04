const { expect } = require('chai');
const { Pipeline } = require('../src/exporter/pipeline');

describe('Export Pipeline', function () {
  it('batches events and calls registered exporter', async function () {
    const pipeline = new Pipeline({ batchSize: 3, batchIntervalMs: 200 });
    const received = [];
    const mockExporter = {
      start: () => {},
      exportBatch: async (batch) => {
        received.push(batch.slice());
      },
      shutdown: async () => {},
    };
    pipeline.registerExporter(mockExporter);

    pipeline.enqueue({ id: 1 });
    pipeline.enqueue({ id: 2 });
    pipeline.enqueue({ id: 3 });

    // wait for dispatch
    await new Promise((r) => setTimeout(r, 300));
    expect(received.length).to.be.at.least(1);
    expect(received[0].length).to.equal(3);
  });
});

