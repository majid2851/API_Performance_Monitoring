class Exporter {
  constructor(options = {}) {
    this.options = options;
    this.started = false;
  }

  async start() {
    this.started = true;
  }

  // batch is an array of events/records
  async exportBatch(batch) {
    throw new Error('exportBatch not implemented');
  }

  // optional scrape for prometheus-style exporters
  scrape() {
    return null;
  }

  async shutdown(timeoutMs = 5000) {
    this.started = false;
  }
}

module.exports = Exporter;

