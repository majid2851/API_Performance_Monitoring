const { expect } = require('chai');
const http = require('http');
const { Pipeline } = require('../src/exporter/pipeline');
const WebhookExporter = require('../src/exporter/webhook');

describe('Webhook Exporter', function () {
  it('posts batches to configured webhook URL', async function () {
    this.timeout(5000);
    let received = null;
    let resolveReceivedPromise;
    const receivedPromise = new Promise(resolve => { resolveReceivedPromise = resolve; });

    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try {
          received = JSON.parse(body);
          resolveReceivedPromise(); // Resolve the promise when data is received
        } catch (e) {
          received = null;
          resolveReceivedPromise();
        }
        res.writeHead(200);
        res.end('ok');
      });
    });

    await new Promise((r) => server.listen(0, r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    const pipeline = new Pipeline({ batchSize: 2, batchIntervalMs: 200 });
    const wh = new WebhookExporter({ url, retries: 0, timeoutMs: 2000, concurrency: 1 });
    pipeline.registerExporter(wh);

    pipeline.enqueue({ a: 1 });
    pipeline.enqueue({ a: 2 });

    await pipeline.flush();
    await receivedPromise; // Wait for the webhook to send data and the server to receive it

    await new Promise((r) => server.close(r));
    expect(received).to.be.an('object');
    expect(received.batch).to.be.an('array').with.lengthOf(2);
  });
});

