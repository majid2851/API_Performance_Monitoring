const EventEmitter = require('events');

class Pipeline extends EventEmitter {
  constructor(options = {}) {
    super();
    this.batchSize = options.batchSize || 100;
    this.batchIntervalMs = options.batchIntervalMs || 1000;
    this.maxQueueLength = options.maxQueueLength || 5000;
    this.overflowPolicy = options.overflowPolicy || 'drop-oldest';
    this.exporters = [];
    this.queue = [];
    this.timer = null;
    this.running = false;
    this.metrics = {
      queueLength: 0,
      batchesSent: 0,
      exportErrors: 0,
      droppedBatches: 0,
      lastSuccess: null,
    };
    this._dispatching = false;
  }

  registerExporter(exp) {
    if (!exp) return;
    this.exporters.push(exp);
    if (typeof exp.start === 'function') exp.start(this);
    this.emit('exporter:registered', exp);
  }

  attachMonitor(monitor) {
    if (!monitor || typeof monitor.on !== 'function') return;
    monitor.on('request', (evt) => this.enqueue(evt));
    // allow monitor to reference pipeline for flush/shutdown
    if (typeof monitor.registerPipeline === 'function') {
      monitor.registerPipeline(this);
    }
  }

  enqueue(event) {
    if (this.queue.length >= this.maxQueueLength) {
      if (this.overflowPolicy === 'drop-oldest') {
        this.queue.shift();
        this.metrics.droppedBatches += 1;
      } else if (this.overflowPolicy === 'drop-newest') {
        this.metrics.droppedBatches += 1;
        return;
      }
    }
    this.queue.push(event);
    this.metrics.queueLength = this.queue.length;
    if (!this.timer) this._startTimer();
    if (this.queue.length >= this.batchSize) {
      // immediate flush
      this._flushNow();
    }
  }

  _startTimer() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this._flushNow();
    }, this.batchIntervalMs);
  }

  _clearTimer() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async _flushNow() {
    this._clearTimer();
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.batchSize);
    this.metrics.queueLength = this.queue.length;
    if (this.queue.length > 0) this._startTimer();
    await this._dispatchBatch(batch);
  }

  async _dispatchBatch(batch) {
    if (this._dispatching) {
      // enqueue at next tick
      setImmediate(() => this._dispatchBatch(batch));
      return;
    }
    this._dispatching = true;
    for (const exporter of this.exporters) {
      try {
        if (typeof exporter.exportBatch === 'function') {
          await exporter.exportBatch(batch);
        }
        this.metrics.batchesSent += 1;
        this.metrics.lastSuccess = Date.now();
      } catch (e) {
        this.metrics.exportErrors += 1;
        this.emit('export:error', e, exporter);
      }
    }
    this._dispatching = false;
  }

  async flush(timeoutMs = 5000) {
    const start = Date.now();
    // flush remaining batches
    while (this.queue.length > 0) {
      await this._flushNow();
      if (Date.now() - start > timeoutMs) break;
    }
    // give exporters a chance to finish
    await Promise.all(this.exporters.map((e) => (e.shutdown ? e.shutdown(1000) : Promise.resolve())));
  }

  async shutdown(timeoutMs = 5000) {
    this.running = false;
    this._clearTimer();
    await this.flush(timeoutMs);
    // call exporter shutdown
    await Promise.all(this.exporters.map((e) => (e.shutdown ? e.shutdown(timeoutMs) : Promise.resolve())));
  }
}

module.exports = { Pipeline };

