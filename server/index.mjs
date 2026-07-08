import http from 'node:http';
import { loadConfig } from './config/index.mjs';
import { createRouter } from './http/router.mjs';
import { createAdminContext } from './admin/context.mjs';
import { registerAuthRoutes } from './admin/routes/auth.mjs';
import { registerUpstreamKeyRoutes } from './admin/routes/upstreamKeys.mjs';
import { registerProxyKeyRoutes } from './admin/routes/proxyKeys.mjs';
import { registerUsageRoutes } from './admin/routes/usage.mjs';
import { createRelayProxyHandlers } from './proxy/relay.mjs';

export function createApp(overrides = {}) {
  const config = { ...loadConfig(), ...overrides };
  const router = createRouter();
  const ctx = createAdminContext(config, overrides);

  router.add('GET', '/health', async (_req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  });

  const proxy = createRelayProxyHandlers(ctx);
  router.add('POST', '/v1/chat/completions', proxy.handleChatCompletions);
  router.add('POST', '/v1/messages', proxy.handleMessages);
  router.add('GET', '/v1/models', proxy.handleModels);

  registerAuthRoutes(router, ctx);
  registerUpstreamKeyRoutes(router, ctx);
  registerProxyKeyRoutes(router, ctx);
  registerUsageRoutes(router, ctx);

  return { config, router, ctx, db: ctx.db };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { config, router } = createApp();
  const server = http.createServer((req, res) => router.handle(req, res));
  server.listen(config.port, config.host, () => {
    console.log(`[info] CC Proxy started http://${config.host}:${config.port}`);
  });
}
