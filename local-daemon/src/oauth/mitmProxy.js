import http from 'node:http';
import https from 'node:https';
import { log } from '../logger.js';
import { updateToken } from './tokenStorage.js';

/**
 * Lightweight MITM Proxy to capture headers from spawned CLIs.
 * Only intended for localhost intercept during 'spawner' execution.
 */

let _server = null;
const CAPTURED_TOKENS = new Map();

export async function startMitmProxy(port = 5060) {
  if (_server) return;

  _server = http.createServer((req, res) => {
    // We only care about the CONNECT method for HTTPS tunneling, 
    // but some simple CLIs might use plain HTTP or we can sniff headers here.
    captureHeaders(req);
    res.writeHead(404);
    res.end();
  });

  // Intercept HTTPS CONNECT tunnels
  _server.on('connect', (req, socket, head) => {
    const [host, port] = req.url.split(':');
    
    log.info(`MITM intercepted tunnel to ${host}`);
    captureHeaders(req);

    // Pass-through tunnel
    const proxySocket = socket;
    const remoteSocket = https.connect({
      host,
      port: port || 443,
      rejectUnauthorized: false // We are sniffing, allow upstream bypass
    }, () => {
      proxySocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      remoteSocket.write(head);
      remoteSocket.pipe(proxySocket);
      proxySocket.pipe(remoteSocket);
    });

    remoteSocket.on('error', (err) => {
      log.error(`MITM remote socket error: ${err.message}`);
      proxySocket.end();
    });
  });

  return new Promise((resolve) => {
    _server.listen(port, '127.0.0.1', () => {
      log.info(`MITM Proxy listening on 127.0.0.1:${port}`);
      resolve();
    });
  });
}

function captureHeaders(req) {
  const auth = req.headers['authorization'] || req.headers['x-api-key'];
  if (!auth) return;

  const host = req.headers['host'] || 'unknown';
  const token = auth.replace(/^Bearer\s+/i, '').trim();

  if (token && token.length > 10) {
    CAPTURED_TOKENS.set(host, token);
    log.info(`MITM captured potential token for ${host} (len=${token.length})`);
    
    // Auto-map common hosts to providers
    if (host.includes('githubcopilot.com')) {
      updateToken('copilot', { accessToken: token, source: 'mitm-capture' });
    } else if (host.includes('anthropic.com')) {
      updateToken('claude', { accessToken: token, source: 'mitm-capture' });
    } else if (host.includes('googleapis.com')) {
      updateToken('gemini', { accessToken: token, source: 'mitm-capture' });
    }
  }
}

export function getCapturedToken(host) {
  return CAPTURED_TOKENS.get(host);
}

export function stopMitmProxy() {
  if (_server) {
    _server.close();
    _server = null;
  }
}
