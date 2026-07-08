import http from 'node:http';
import { loadConfig } from './config/index.mjs';
import { createRouter } from './http/router.mjs';

export function createApp(config = loadConfig()) {
  const router = createRouter();

  router.add('GET', '/health', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  return { config, router };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { config, router } = createApp();
  const server = http.createServer((req, res) => router.handle(req, res));
  server.listen(config.port, config.host, () => {
    console.log(`[info] CC Proxy started http://${config.host}:${config.port}`);
  });
}
