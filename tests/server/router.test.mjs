import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../server/config/index.mjs';
import { createRouter } from '../../server/http/router.mjs';
import { parseCookies, serializeCookie } from '../../server/http/cookies.mjs';

describe('config', () => {
  it('uses /app/data/cc-proxy.sqlite by default', () => {
    const cfg = loadConfig({}, 'C:/repo');
    expect(cfg.databasePath.replace(/\\/g, '/')).toBe('/app/data/cc-proxy.sqlite');
    expect(cfg.port).toBe(3000);
  });

  it('honors env overrides', () => {
    const cfg = loadConfig({ PORT: '3050', HOST: '127.0.0.1', DATABASE_PATH: 'C:/tmp/app.sqlite' }, 'C:/repo');
    expect(cfg.port).toBe(3050);
    expect(cfg.host).toBe('127.0.0.1');
    expect(cfg.databasePath.replace(/\\/g, '/')).toBe('C:/tmp/app.sqlite');
  });
});

describe('router', () => {
  it('matches method and exact path', async () => {
    const router = createRouter();
    router.add('GET', '/health', async (_req, res) => {
      res.statusCode = 200;
      res.end('OK');
    });
    const calls = [];
    const req = { method: 'GET', url: '/health', headers: { host: 'localhost' } };
    const res = { setHeader() {}, end(body) { calls.push(body); } };
    await router.handle(req, res);
    expect(calls).toEqual(['OK']);
  });
});

describe('cookies', () => {
  it('parses and serializes cookies', () => {
    expect(parseCookies('a=1; b=two')).toEqual({ a: '1', b: 'two' });
    expect(serializeCookie('sid', 'abc', { httpOnly: true, sameSite: 'Lax' })).toContain('HttpOnly');
  });
});
