import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createApp } from '../../server/index.mjs';

export const testSecrets = {
  encryptionKey: randomBytes(32).toString('base64url'),
  sessionSecret: randomBytes(32).toString('base64url'),
};

export async function createTestApp(overrides = {}) {
  return createApp({
    databasePath: ':memory:',
    host: '127.0.0.1',
    port: 0,
    ...testSecrets,
    ...overrides,
  });
}

export async function createInitializedApp(overrides = {}) {
  const app = await createTestApp(overrides);
  await request(app, 'POST', '/admin/api/auth/init', { username: 'admin', password: 'pass123456' });
  return app;
}

export async function loginAsAdmin(app) {
  const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });
  app.__adminCookie = login.cookie;
  app.__csrfToken = login.body.csrfToken;
  return login;
}

export async function adminRequest(app, method, url, body = null, headers = {}) {
  if (!app.__adminCookie) await loginAsAdmin(app);
  return request(app, method, url, body, {
    Cookie: app.__adminCookie,
    'X-CSRF-Token': app.__csrfToken,
    ...headers,
  });
}

export async function request(app, method, url, body = null, headers = {}) {
  const payload = body == null ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Readable.from(payload);
  req.method = method;
  req.url = url;
  req.headers = {
    host: '127.0.0.1',
    'content-type': 'application/json',
    ...Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])),
  };

  const responseHeaders = {};
  const chunks = [];
  const res = {
    statusCode: 200,
    setHeader(name, value) {
      responseHeaders[name.toLowerCase()] = value;
    },
    getHeader(name) {
      return responseHeaders[name.toLowerCase()];
    },
    writeHead(status, headersToSet = {}) {
      this.statusCode = status;
      for (const [name, value] of Object.entries(headersToSet)) {
        this.setHeader(name, value);
      }
    },
    write(chunk) {
      chunks.push(Buffer.from(chunk));
    },
    end(chunk = '') {
      if (chunk) chunks.push(Buffer.from(chunk));
    },
  };

  await app.router.handle(req, res);
  const text = Buffer.concat(chunks).toString('utf8');
  const setCookie = responseHeaders['set-cookie'];
  return {
    status: res.statusCode,
    headers: responseHeaders,
    text,
    body: text && responseHeaders['content-type']?.includes('application/json') ? JSON.parse(text) : null,
    cookie: Array.isArray(setCookie) ? setCookie.map((value) => value.split(';')[0]).join('; ') : setCookie?.split(';')[0],
  };
}
