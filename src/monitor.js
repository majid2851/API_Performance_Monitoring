const EventEmitter = require('events');

class Monitor extends EventEmitter {
  constructor(config = {}) {
    super();
    this.service = config.service || 'unknown-service';
    this.env = config.env || process.env.NODE_ENV || 'development';
    // sampling: 0..1 (1 = sample all)
    this.sampling = typeof config.sampling === 'number' ? config.sampling : 1;
    this.inFlight = 0;
    this._closed = false;
  }

  // Core Express-compatible middleware that tracks lifecycle per request.
  middleware() {
    const self = this;
    return function apmMiddleware(req, res, next) {
      if (self._closed) return next();

      const sampled = Math.random() < self.sampling;
      const start = process.hrtime.bigint();
      self.inFlight++;
      let ended = false;

      function finishHandler() {
        if (ended) return;
        ended = true;
        try {
          self.inFlight = Math.max(0, self.inFlight - 1);
          const end = process.hrtime.bigint();
          const durationMs = Number(end - start) / 1e6;
          const status = typeof res.statusCode === 'number' ? res.statusCode : 0;
          const statusClass = Math.floor(status / 100) * 100;
          // route template resolution: prefer explicit override, then Express route, then path
          const route =
            req._apmRoute ||
            (req.route && req.route.path) ||
            req.baseUrl + (req.route && req.route.path ? req.route.path : '') ||
            req.path ||
            req.originalUrl ||
            req.url ||
            'unknown';

          const event = {
            service: self.service,
            env: self.env,
            method: req.method,
            route,
            status,
            statusClass,
            durationMs,
            timestamp: Date.now(),
            sampled,
          };

          // emit asynchronously to avoid blocking response path
          setImmediate(() => {
            try {
              self.emit('request', event);
            } catch (err) {
              // Swallow any listener errors to avoid impacting app
            }
          });
        } catch (err) {
          // never crash the app for monitoring errors
        }
      }

      res.once('finish', finishHandler);
      res.once('close', finishHandler);

      try {
        return next();
      } catch (err) {
        // If next throws synchronously, ensure we record and rethrow
        finishHandler();
        throw err;
      }
    };
  }

  // Helper middleware to attach a route template when you register routes.
  // Usage: app.get('/users/:id', monitor.route('/users/:id'), handler)
  route(routeTemplate) {
    return (req, res, next) => {
      try {
        req._apmRoute = routeTemplate;
      } catch (e) {
        // ignore
      }
      return next();
    };
  }

  // Programmatic setter for frameworks that resolve templates differently
  setRoute(req, routeTemplate) {
    try {
      req._apmRoute = routeTemplate;
    } catch (e) {}
  }

  getInFlight() {
    return this.inFlight;
  }

  close() {
    this._closed = true;
  }
}

function createMonitor(config) {
  return new Monitor(config);
}

module.exports = { Monitor, createMonitor };

