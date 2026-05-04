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
      } catch (err) {
        if (attempt <= this.retries) {
          const backoff = Math.min(1000 * 2 ** attempt, 30000);
          await new Promise((r) => setTimeout(r, backoff));
          return send();
        }
        throw err;
      }
    };
    // concurrency: simple guard
    while (this._inflight >= this.concurrency) {
      await new Promise((r) => setTimeout(r, 50));
    }
    this._inflight++;
    try {
      await send();
    } finally {
      this._inflight = Math.max(0, this._inflight - 1);
    }
  }
}

module.exports = WebhookExporter;

