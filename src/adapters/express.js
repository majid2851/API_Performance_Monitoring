const { Monitor } = require('../monitor');

// Lightweight convenience wrapper — returns the monitor.middleware().
// Accepts either an existing Monitor instance or a config object.
function expressAdapter(monitorOrConfig) {
  let monitor;
  if (monitorOrConfig instanceof Monitor) {
    monitor = monitorOrConfig;
  } else {
    monitor = new Monitor(monitorOrConfig || {});
  }
  return {
    monitor,
    middleware: monitor.middleware.bind(monitor),
    route: monitor.route.bind(monitor),
  };
}

module.exports = expressAdapter;

