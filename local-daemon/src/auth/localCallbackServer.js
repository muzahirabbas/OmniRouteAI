import http from 'node:http';
import { log } from '../core/logger.js';
import { handleOAuthCallback } from './oauthFlow.js';

const callbackServers = new Map();
let daemonUrl = 'http://127.0.0.1:5059';

export function setDaemonUrl(url) {
  daemonUrl = url;
}

export async function startLocalCallbackServer(tool, fixedPort = null) {
  const port = fixedPort || await findAvailablePort(1455, 1465);
  
  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.url.startsWith('/callback')) {
        const url = new URL(req.url, `http://localhost:${port}`);
        const params = Object.fromEntries(url.searchParams);
        
        log.info(`Local callback received for ${tool}:`, params);
        
        callbackServers.set(tool, { params, resolved: false, port });
        
        if (params.code || params.error) {
          callbackServers.set(tool, { params, resolved: true, port });
          
          if (params.code && params.state) {
            try {
              await handleOAuthCallback(params.code, params.state);
              log.info(`OAuth callback processed successfully for ${tool}`);
            } catch (err) {
              log.error(`OAuth callback error for ${tool}: ${err.message}`);
            }
          }
        }
        
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <html>
            <body>
              <h2>Authentication ${params.error ? 'Failed' : 'Successful'}!</h2>
              <p>You can close this window now.</p>
              <script>setTimeout(() => window.close(), 2000);</script>
            </body>
          </html>
        `);
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.on('error', (err) => {
      log.error(`Local callback server error: ${err.message}`);
      reject(err);
    });

    server.listen(port, '127.0.0.1', () => {
      log.info(`Local callback server started for ${tool} on port ${port}`);
      callbackServers.set(tool, { server, port, resolved: false });
      resolve({ port, server });
    });
  });
}

export function initCallback(tool) {
  const existing = callbackServers.get(tool);
  if (!existing?.resolved) {
    callbackServers.set(tool, { ...existing, resolved: false });
  }
}

export function resolveCallback(tool, params) {
  const existing = callbackServers.get(tool);
  callbackServers.set(tool, { ...existing, params, resolved: true });
}

export async function waitForCallback(tool, timeout = 300000) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    const data = callbackServers.get(tool);
    if (data?.resolved) {
      return data.params;
    }
    await new Promise(r => setTimeout(r, 100));
  }
  
  throw new Error('OAuth callback timeout');
}

export async function stopLocalCallbackServer(tool) {
  const data = callbackServers.get(tool);
  if (data?.server) {
    return new Promise((resolve) => {
      data.server.close(() => {
        callbackServers.delete(tool);
        log.info(`Local callback server stopped for ${tool}`);
        resolve();
      });
    });
  }
}

export function getCallbackStatus(tool) {
  const data = callbackServers.get(tool);
  if (data?.resolved) {
    return { status: 'success', params: data.params };
  }
  return { status: 'pending' };
}

function findAvailablePort(start, end) {
  return new Promise((resolve, reject) => {
    const tryPort = (port) => {
      if (port > end) {
        reject(new Error('No available ports'));
        return;
      }
      
      const server = http.createServer();
    server.listen(port, 'localhost', () => {
        server.close(() => resolve(port));
      });
      server.on('error', () => tryPort(port + 1));
    };
    tryPort(start);
  });
}
