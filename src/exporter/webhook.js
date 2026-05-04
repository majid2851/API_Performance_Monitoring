const Exporter = require('./base');

class WebhookExporter extends Exporter {
  constructor(options = {}) {
    super(options);
    this.url = options.url;
    this.retries = options.retries || 3;
    this.timeoutMs = options.timeoutMs || 5000;
    this.concurrency = options.concurrency || 2;
    this._inflight = 0;
  }

  async exportBatch(batch) {
    if (!this.url) throw new Error('webhook url not configured');
    // simple retry with exponential backoff
    const body = JSON.stringify({ batch });
    let attempt = 0;
    const send = async () => {
      attempt++;
      try {
        // Use global fetch if available; otherwise fall back to native http/https
        if (typeof fetch === 'function') {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), this.timeoutMs);
          const resp = await fetch(this.url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body,
            signal: controller.signal,
          });
          clearTimeout(id);
          if (!resp.ok) throw new Error(`http ${resp.status}`);
          return;
        }

        // Fallback using built-in http/https to avoid dependency on fetch
        await new Promise((resolve, reject) => {
          try {
            const urlObj = new URL(this.url);
            const lib = urlObj.protocol === 'https:' ? require('https') : require('http');
            const opts = {
              method: 'POST',
              hostname: urlObj.hostname,
              port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
              path: urlObj.pathname + (urlObj.search || ''),
              headers: {
                'content-type': 'application/json',
                'content-length': Buffer.byteLength(body),
              },
              timeout: this.timeoutMs,
            };
            const req = lib.request(opts, (res) => {
              const { statusCode } = res;
              // drain response
              res.on('data', () => {});
              res.on('end', () => {
                if (statusCode >= 200 && statusCode < 300) resolve();
                else reject(new Error(`http ${statusCode}`));
              });
            });
            req.on('timeout', () => {
              req.destroy(new Error('timeout'));
            });
            req.on('error', (err) => reject(err));
            req.write(body);
            req.end();
          } catch (err) {
            reject(err);
          }
        });
        return;
      } catch (err) {
        if (attempt <= this.retries) {
          const backoff = Math.min(1000 * 2 ** attempt, 30000);
          await new Promise((r) => setTimeout(r, backoff));
          return send();
        }
        throw err;
      }
    };
    await send();
  }
}

module.exports = WebhookExporter;

