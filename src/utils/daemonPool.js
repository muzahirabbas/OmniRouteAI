const DAEMON_COOLDOWN_MS = 30000;

class DaemonPool {
  constructor(daemonList) {
    this.daemons = daemonList.map(d => ({
      url: d.url.replace(/\/+$/, ''),
      token: d.token || '',
      failedAt: 0
    }));
  }

  getHealthyDaemons() {
    const now = Date.now();
    return this.daemons.filter(d => now - d.failedAt >= DAEMON_COOLDOWN_MS);
  }

  getRandomDaemon() {
    const healthy = this.getHealthyDaemons();
    if (healthy.length > 0) {
      return healthy[Math.floor(Math.random() * healthy.length)];
    }
    this.daemons.sort((a, b) => a.failedAt - b.failedAt);
    return { ...this.daemons[0] };
  }

  markFailed(url) {
    const d = this.daemons.find(d => d.url === url);
    if (d) d.failedAt = Date.now();
  }

  getAllDaemons() {
    return this.daemons.map(d => ({ url: d.url, token: d.token }));
  }
}

let _instance = null;

function loadDaemonPool() {
  if (_instance) return _instance;

  const json = process.env.LOCAL_DAEMONS;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _instance = new DaemonPool(parsed);
        return _instance;
      }
    } catch (e) {
      console.error('Invalid LOCAL_DAEMONS env var:', e.message);
    }
  }

  const url = (process.env.LOCAL_DAEMON_URL || 'http://localhost:5059').replace(/\/+$/, '');
  const token = process.env.LOCAL_DAEMON_TOKEN || '';
  _instance = new DaemonPool([{ url, token }]);
  return _instance;
}

export { DaemonPool, loadDaemonPool };
