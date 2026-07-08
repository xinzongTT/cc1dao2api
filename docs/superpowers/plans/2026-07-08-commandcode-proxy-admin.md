# CommandCode Proxy Admin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a personal/small-team CommandCode relay station with a React admin panel, encrypted upstream key pool, relay keys, quota display, usage accounting, and round-robin routing.

**Architecture:** Keep one deployable Node service. Split the current single-file proxy into focused ESM modules under `server/`, persist state in SQLite under `/app/data/cc-proxy.sqlite`, and serve a Vite-built React admin UI from the same HTTP server.

**Tech Stack:** Node ESM, native `http`, `better-sqlite3`, Node `crypto`, Vitest, React, Vite, Lucide React, custom CSS/SVG charts.

## Global Constraints

- Runtime must remain a single Node service for proxy API, admin API, and static admin UI.
- Default database path is `/app/data/cc-proxy.sqlite`.
- Clients call proxy endpoints with `Authorization: Bearer sk-ccp_...`; upstream `user_...` keys are selected server-side.
- Upstream `user_...` keys must be AES-256-GCM encrypted at rest using `ENCRYPTION_KEY`.
- `ENCRYPTION_KEY` must decode to exactly 32 random bytes from base64url or base64.
- Relay keys must be `sk-ccp_` plus at least 32 bytes of cryptographically random entropy encoded URL-safely.
- Relay key hashes must use `HMAC-SHA256(RELAY_KEY_PEPPER, plaintext_key)` and constant-time comparison.
- If `RELAY_KEY_PEPPER` is absent, derive it from `ENCRYPTION_KEY` with a distinct HKDF context.
- Admin initialization is anonymous only while `admin_users` is empty; after that `POST /admin/api/auth/init` returns `409`.
- Token limit check and `usage_reservations` insert must happen in one SQLite transaction using `BEGIN IMMEDIATE` or equivalent.
- Output reservation uses request `max_tokens` when present; otherwise `default_reservation_tokens=8192`.
- Input reservation uses an input estimate when present; otherwise `default_input_reservation_tokens=4096`.
- Calculated reservation is clamped by `max_reservation_tokens=200000`.
- Proxy-generated timeout or zero-output 429 errors must not mark an upstream key `limited`.
- Do not store or log prompts, request bodies, response bodies, full upstream keys, or full relay keys.
- UI must follow the Data-Dense Dashboard direction: dense tables, KPI rows, left desktop sidebar, responsive mobile nav, semantic status colors, no emoji structural icons.
- Out of scope: public registration, payment/recharge, SaaS tenants, multiple admin roles, weighted routing, automatic streaming retry across upstream keys, Postgres/MySQL.

---

## File Structure

Create and modify these files during implementation:

- `package.json`: add scripts and dependencies.
- `server/index.mjs`: process boot, config load, migration, HTTP routing, static UI serving.
- `server/config/index.mjs`: config defaults, environment overrides, data path resolution.
- `server/http/router.mjs`: native HTTP route matcher and response helpers.
- `server/http/body.mjs`: JSON body reader with size limits.
- `server/http/cookies.mjs`: cookie parsing/serialization helpers.
- `server/db/connection.mjs`: SQLite open/close and transaction helpers.
- `server/db/migrations.mjs`: schema creation and migration versioning.
- `server/db/repositories/*.mjs`: data access for admin, upstream keys, relay keys, routing, usage, settings, sessions.
- `server/security/secrets.mjs`: environment secret decoding, HKDF derivation, secure random key generation.
- `server/security/encryption.mjs`: AES-256-GCM envelope encryption/decryption.
- `server/security/keys.mjs`: relay key generation, HMAC hashing, constant-time comparison.
- `server/security/passwords.mjs`: scrypt password hashing and verification.
- `server/security/sessions.mjs`: cookie session creation, rotation, validation, CSRF/Origin checks.
- `server/admin/routes/*.mjs`: admin auth, dashboard, upstream, relay, usage, settings routes.
- `server/proxy/legacy.mjs`: extracted current CommandCode compatibility logic from `proxy.mjs`.
- `server/proxy/relay.mjs`: relay-key authorization, reservation, upstream selection, call into legacy proxy handlers.
- `server/proxy/models.mjs`: model list routing/fallback with selected upstream key.
- `server/quota/provider.mjs`: pluggable quota provider interface and initial probing implementation.
- `server/scheduler/index.mjs`: quota refresh, reservation cleanup, recent event cleanup.
- `web/index.html`: Vite entry HTML.
- `web/vite.config.js`: Vite config.
- `web/src/main.jsx`: React mount.
- `web/src/App.jsx`: route shell.
- `web/src/lib/api.js`: admin API client.
- `web/src/lib/format.js`: number/date/key masking helpers.
- `web/src/components/*.jsx`: shell, KPI cards, tables, status badges, forms, charts.
- `web/src/pages/*.jsx`: login/init, dashboard, upstream keys, relay keys, usage analytics, settings.
- `web/src/styles.css`: design tokens and responsive layout.
- `tests/server/*.test.mjs`: backend unit/integration tests.
- `tests/web/*.test.jsx`: frontend component tests.
- `Dockerfile`: copy server, built UI, package lock, data directory.
- `docker-compose.yml`: mount `/app/data`.
- `README.md` and `README_zh.md`: document new admin mode, env vars, relay key usage.

---

### Task 1: Project Tooling And Modular Server Skeleton

**Files:**
- Modify: `package.json`
- Create: `server/index.mjs`
- Create: `server/config/index.mjs`
- Create: `server/http/router.mjs`
- Create: `server/http/body.mjs`
- Create: `server/http/cookies.mjs`
- Create: `tests/server/router.test.mjs`
- Create: `vitest.config.mjs`

**Interfaces:**
- Produces: `loadConfig(env?: object, cwd?: string): AppConfig`
- Produces: `createRouter(): { add(method, path, handler), handle(req, res) }`
- Produces: `sendJson(res, status, payload, headers?)`
- Produces: `readJsonBody(req, maxBytes): Promise<object>`
- Produces: `parseCookies(header): Record<string,string>`
- Produces: `serializeCookie(name, value, options): string`

- [ ] **Step 1: Install runtime and test dependencies**

Run:

```powershell
npm install better-sqlite3 cookie
npm install -D vitest jsdom vite @vitejs/plugin-react react react-dom @testing-library/react @testing-library/user-event @testing-library/jest-dom lucide-react
```

Expected: `package.json` and `package-lock.json` are updated, npm exits with code 0.

- [ ] **Step 2: Update scripts**

Edit `package.json` so scripts include:

```json
{
  "scripts": {
    "start": "node server/index.mjs",
    "dev": "node --watch server/index.mjs",
    "test": "vitest run",
    "test:watch": "vitest",
    "build:web": "vite build --config web/vite.config.js",
    "build": "npm run build:web",
    "docker:build": "docker build -t commandcode-proxy:latest .",
    "docker:build:multi": "docker buildx build --platform linux/amd64,linux/arm64 -t commandcode-proxy:latest ."
  }
}
```

- [ ] **Step 3: Write failing router/config tests**

Create `tests/server/router.test.mjs` with tests that assert:

```js
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
```

- [ ] **Step 4: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/router.test.mjs
```

Expected: FAIL because `server/config/index.mjs`, `server/http/router.mjs`, and `server/http/cookies.mjs` do not exist.

- [ ] **Step 5: Implement config/router/body/cookies and server health**

Create the modules with these exported names:

```js
// server/config/index.mjs
export function loadConfig(env = process.env, cwd = process.cwd()) {
  return {
    port: Number.parseInt(env.PORT || '3000', 10),
    host: env.HOST || '0.0.0.0',
    apiBase: env.CC_API_BASE || 'https://api.commandcode.ai',
    projectSlug: env.PROJECT_SLUG || 'cc-proxy',
    databasePath: env.DATABASE_PATH || '/app/data/cc-proxy.sqlite',
    logFile: env.LOG_FILE || '',
    logLevel: env.LOG_LEVEL || 'info',
    useProviderModels: env.CC_USE_PROVIDER_MODELS !== 'false',
    modelRefreshIntervalMs: Number.parseInt(env.MODEL_REFRESH_INTERVAL_MS || '300000', 10),
    defaultReservationTokens: Number.parseInt(env.DEFAULT_RESERVATION_TOKENS || '8192', 10),
    defaultInputReservationTokens: Number.parseInt(env.DEFAULT_INPUT_RESERVATION_TOKENS || '4096', 10),
    maxReservationTokens: Number.parseInt(env.MAX_RESERVATION_TOKENS || '200000', 10),
    encryptionKey: env.ENCRYPTION_KEY || '',
    relayKeyPepper: env.RELAY_KEY_PEPPER || '',
    sessionSecret: env.SESSION_SECRET || '',
  };
}
```

```js
// server/http/router.mjs
export function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(payload));
}

export function createRouter() {
  const routes = [];
  return {
    add(method, path, handler) {
      routes.push({ method, path, handler });
    },
    async handle(req, res) {
      const host = req.headers?.host || 'localhost';
      const url = new URL(req.url, `http://${host}`);
      const route = routes.find((r) => r.method === req.method && r.path === url.pathname);
      if (!route) return sendJson(res, 404, { error: { message: 'Not found', type: 'not_found' } });
      return route.handler(req, res, url);
    },
  };
}
```

```js
// server/http/cookies.mjs
import { parse, serialize } from 'cookie';
export function parseCookies(header = '') { return parse(header || ''); }
export function serializeCookie(name, value, options = {}) { return serialize(name, value, options); }
```

```js
// server/http/body.mjs
export async function readJsonBody(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Request body exceeds limit');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}
```

```js
// server/index.mjs
import http from 'http';
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
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- tests/server/router.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json vitest.config.mjs server tests/server/router.test.mjs
git commit -m "chore: add modular server skeleton"
```

---

### Task 2: SQLite Schema, Migrations, And Repositories

**Files:**
- Create: `server/db/connection.mjs`
- Create: `server/db/migrations.mjs`
- Create: `server/db/repositories/adminUsers.mjs`
- Create: `server/db/repositories/settings.mjs`
- Create: `server/db/repositories/upstreamKeys.mjs`
- Create: `server/db/repositories/proxyKeys.mjs`
- Create: `server/db/repositories/routingState.mjs`
- Create: `server/db/repositories/usage.mjs`
- Create: `tests/server/db.test.mjs`

**Interfaces:**
- Consumes: `loadConfig()`
- Produces: `openDatabase(databasePath): Database`
- Produces: `migrate(db): void`
- Produces: repository functions named in each module, using plain JS objects.

- [ ] **Step 1: Write failing migration/repository tests**

Create `tests/server/db.test.mjs` with assertions for:

```js
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../../server/db/connection.mjs';
import { migrate } from '../../server/db/migrations.mjs';
import { createAdminUser, countAdminUsers } from '../../server/db/repositories/adminUsers.mjs';
import { getSetting, setSetting } from '../../server/db/repositories/settings.mjs';
import { insertRoutingCursor, nextRoutingCursor } from '../../server/db/repositories/routingState.mjs';

function memoryDb() {
  const db = openDatabase(':memory:');
  migrate(db);
  return db;
}

describe('database migrations', () => {
  it('creates required tables and migration version', () => {
    const db = memoryDb();
    const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
    expect(tables).toContain('admin_users');
    expect(tables).toContain('upstream_keys');
    expect(tables).toContain('proxy_keys');
    expect(tables).toContain('usage_reservations');
    expect(tables).toContain('routing_state');
  });

  it('stores admin users and settings', () => {
    const db = memoryDb();
    expect(countAdminUsers(db)).toBe(0);
    createAdminUser(db, { username: 'admin', passwordHash: 'hash', passwordSalt: 'salt' });
    expect(countAdminUsers(db)).toBe(1);
    setSetting(db, 'quota_refresh_interval_ms', '300000');
    expect(getSetting(db, 'quota_refresh_interval_ms')).toBe('300000');
  });

  it('increments routing cursor transactionally', () => {
    const db = memoryDb();
    insertRoutingCursor(db, 'upstream_round_robin', 0);
    expect(nextRoutingCursor(db, 'upstream_round_robin')).toBe(1);
    expect(nextRoutingCursor(db, 'upstream_round_robin')).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/db.test.mjs
```

Expected: FAIL because DB modules do not exist.

- [ ] **Step 3: Implement schema**

Create `migrate(db)` with `PRAGMA foreign_keys = ON` and `CREATE TABLE IF NOT EXISTS` for every table in the spec:

```sql
admin_users(id integer primary key, username text unique not null, password_hash text not null, password_salt text not null, created_at text not null, last_login_at text)
upstream_keys(id integer primary key, name text not null, encrypted_key_envelope text not null, key_fingerprint text unique not null, admin_enabled integer not null default 1, health_status text not null default 'unknown', quota_status text not null default 'unknown', quota_total_tokens integer, quota_used_tokens integer, quota_remaining_tokens integer, quota_reset_at text, last_quota_checked_at text, last_success_at text, last_error_at text, last_error_message text, notes text not null default '', created_at text not null, updated_at text not null)
proxy_keys(id integer primary key, name text not null, key_hash text unique not null, key_prefix text not null, status text not null default 'enabled', daily_token_limit integer, monthly_token_limit integer, allowed_models_json text not null default '[]', last_used_at text, notes text not null default '', created_at text not null, updated_at text not null)
usage_events_recent(request_id text primary key, proxy_key_id integer, upstream_key_id integer, endpoint text not null, model text, status_code integer, success integer not null, input_tokens integer not null default 0, output_tokens integer not null default 0, cached_tokens integer not null default 0, duration_ms integer not null default 0, error_type text, created_at text not null)
usage_hourly(bucket_start text not null, upstream_key_id integer, proxy_key_id integer, model text not null, endpoint text not null, request_count integer not null default 0, success_count integer not null default 0, error_count integer not null default 0, input_tokens integer not null default 0, output_tokens integer not null default 0, cached_tokens integer not null default 0, total_tokens integer not null default 0, avg_duration_ms real not null default 0, primary key(bucket_start, upstream_key_id, proxy_key_id, model, endpoint))
usage_daily(bucket_start text not null, upstream_key_id integer, proxy_key_id integer, model text not null, endpoint text not null, request_count integer not null default 0, success_count integer not null default 0, error_count integer not null default 0, input_tokens integer not null default 0, output_tokens integer not null default 0, cached_tokens integer not null default 0, total_tokens integer not null default 0, avg_duration_ms real not null default 0, primary key(bucket_start, upstream_key_id, proxy_key_id, model, endpoint))
settings(key text primary key, value text not null, updated_at text not null)
routing_state(name text primary key, cursor_value integer not null default 0, updated_at text not null)
usage_reservations(request_id text primary key, proxy_key_id integer not null, reserved_tokens integer not null, settled_tokens integer not null default 0, status text not null, created_at text not null, settled_at text)
usage_adjustments(id integer primary key, proxy_key_id integer not null, period_type text not null, period_start text not null, offset_tokens integer not null, reason text not null, created_at text not null)
admin_sessions(id text primary key, admin_user_id integer not null, csrf_token text not null, created_at text not null, expires_at text not null)
```

Create indexes named:

```sql
idx_usage_events_created_at
idx_usage_events_proxy_key
idx_usage_events_upstream_key
idx_usage_hourly_bucket
idx_usage_daily_bucket
idx_usage_reservations_proxy_status
```

- [ ] **Step 4: Implement repository functions**

Each repository exports only focused functions:

```js
// adminUsers.mjs
export function countAdminUsers(db) {}
export function createAdminUser(db, { username, passwordHash, passwordSalt }) {}
export function findAdminByUsername(db, username) {}
export function touchAdminLogin(db, id) {}

// settings.mjs
export function getSetting(db, key) {}
export function setSetting(db, key, value) {}

// routingState.mjs
export function insertRoutingCursor(db, name, cursorValue = 0) {}
export function nextRoutingCursor(db, name) {}
```

Use `new Date().toISOString()` for timestamps.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/server/db.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/db tests/server/db.test.mjs
git commit -m "feat: add sqlite schema and repositories"
```

---

### Task 3: Secret Handling, Encryption, Relay Keys, Passwords, Sessions

**Files:**
- Create: `server/security/secrets.mjs`
- Create: `server/security/encryption.mjs`
- Create: `server/security/keys.mjs`
- Create: `server/security/passwords.mjs`
- Create: `server/security/sessions.mjs`
- Create: `tests/server/security.test.mjs`

**Interfaces:**
- Produces: `decodeEncryptionKey(raw): Buffer`
- Produces: `deriveRelayPepper(encryptionKey, rawPepper?): Buffer`
- Produces: `encryptEnvelope(plaintext, key, keyId='default'): string`
- Produces: `decryptEnvelope(envelope, key): string`
- Produces: `generateRelayKey(): string`
- Produces: `hashRelayKey(plaintext, pepper): string`
- Produces: `verifyRelayKey(plaintext, expectedHash, pepper): boolean`
- Produces: `hashPassword(password): Promise<{ hash, salt }>`
- Produces: `verifyPassword(password, salt, hash): Promise<boolean>`
- Produces: `createSession(db, adminUserId, now?): { sessionId, csrfToken, expiresAt }`

- [ ] **Step 1: Write failing security tests**

Create `tests/server/security.test.mjs`:

```js
import { describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { decodeEncryptionKey, deriveRelayPepper } from '../../server/security/secrets.mjs';
import { encryptEnvelope, decryptEnvelope } from '../../server/security/encryption.mjs';
import { generateRelayKey, hashRelayKey, verifyRelayKey } from '../../server/security/keys.mjs';
import { hashPassword, verifyPassword } from '../../server/security/passwords.mjs';

describe('security primitives', () => {
  it('requires a 32 byte encryption key', () => {
    const raw = randomBytes(32).toString('base64url');
    expect(decodeEncryptionKey(raw)).toHaveLength(32);
    expect(() => decodeEncryptionKey('short')).toThrow(/32 bytes/);
  });

  it('encrypts and decrypts upstream key envelopes', () => {
    const key = randomBytes(32);
    const env = encryptEnvelope('user_secret_key', key);
    expect(env.startsWith('enc:v1:default:')).toBe(true);
    expect(decryptEnvelope(env, key)).toBe('user_secret_key');
    expect(() => decryptEnvelope(env, randomBytes(32))).toThrow();
  });

  it('generates and verifies relay keys', () => {
    const encryptionKey = randomBytes(32);
    const pepper = deriveRelayPepper(encryptionKey);
    const relayKey = generateRelayKey();
    expect(relayKey.startsWith('sk-ccp_')).toBe(true);
    const hash = hashRelayKey(relayKey, pepper);
    expect(verifyRelayKey(relayKey, hash, pepper)).toBe(true);
    expect(verifyRelayKey(`${relayKey}x`, hash, pepper)).toBe(false);
  });

  it('hashes and verifies passwords', async () => {
    const { hash, salt } = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', salt, hash)).toBe(true);
    expect(await verifyPassword('wrong', salt, hash)).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/security.test.mjs
```

Expected: FAIL because security modules do not exist.

- [ ] **Step 3: Implement security modules**

Implementation rules:

```js
// secrets.mjs
// decode base64url first, fall back to base64, require length 32.
// derive relay pepper with hkdfSync('sha256', encryptionKey, 'cc-proxy', 'relay-key-pepper', 32).

// encryption.mjs
// envelope: enc:v1:<key_id>:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>
// IV length: 12 bytes.
// Auth tag length: 16 bytes.

// keys.mjs
// generateRelayKey uses randomBytes(32).toString('base64url').
// hashRelayKey returns hex HMAC-SHA256.
// verifyRelayKey uses timingSafeEqual on equal-length buffers.

// passwords.mjs
// scrypt parameters use Node defaults; salt is 16 random bytes base64url.
// hash format stores derived key as base64url.
```

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/server/security.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/security tests/server/security.test.mjs
git commit -m "feat: add key encryption and auth primitives"
```

---

### Task 4: Admin Authentication API

**Files:**
- Create: `server/admin/context.mjs`
- Create: `server/admin/routes/auth.mjs`
- Modify: `server/index.mjs`
- Modify: `server/db/repositories/adminUsers.mjs`
- Create: `server/db/repositories/sessions.mjs`
- Create: `tests/server/admin-auth.test.mjs`

**Interfaces:**
- Consumes: DB and security modules from Tasks 2-3.
- Produces: `registerAuthRoutes(router, ctx): void`
- Produces: `requireAdminSession(req, res, ctx): AdminSession | null`
- Produces routes: `POST /admin/api/auth/init`, `POST /admin/api/auth/login`, `POST /admin/api/auth/logout`, `GET /admin/api/session`.

- [ ] **Step 1: Write failing auth integration tests**

Create `tests/server/admin-auth.test.mjs` using `createApp({ databasePath: ':memory:', ...testSecrets })` and an in-process request helper. Test these cases:

```js
it('initializes first admin exactly once', async () => {
  const app = await createTestApp();
  const first = await request(app, 'POST', '/admin/api/auth/init', { username: 'admin', password: 'pass123456' });
  expect(first.status).toBe(200);
  const second = await request(app, 'POST', '/admin/api/auth/init', { username: 'root', password: 'pass123456' });
  expect(second.status).toBe(409);
});

it('logs in and returns session state', async () => {
  const app = await createInitializedApp();
  const login = await request(app, 'POST', '/admin/api/auth/login', { username: 'admin', password: 'pass123456' });
  expect(login.status).toBe(200);
  expect(login.headers['set-cookie']).toContain('ccp_session=');
  const session = await request(app, 'GET', '/admin/api/session', null, { Cookie: login.cookie });
  expect(session.body.ok).toBe(true);
  expect(session.body.admin.username).toBe('admin');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/admin-auth.test.mjs
```

Expected: FAIL because auth routes are not registered.

- [ ] **Step 3: Implement admin context and auth routes**

Rules:

- `POST /admin/api/auth/init` checks `countAdminUsers(db) === 0` and inserts in one transaction.
- Password minimum is 8 characters.
- Login failure returns `{ ok:false, error:{ code:'invalid_credentials', message:'Invalid username or password' } }` with status `401`.
- Login success rotates session by creating a new `admin_sessions` row and setting `ccp_session`.
- `GET /admin/api/session` returns `{ ok:true, admin:{ id, username } }` if cookie is valid; otherwise `{ ok:false }`.
- `POST /admin/api/auth/logout` deletes the current session and clears cookie.

- [ ] **Step 4: Run tests**

Run:

```powershell
npm test -- tests/server/admin-auth.test.mjs tests/server/security.test.mjs tests/server/db.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add server/admin server/db/repositories/sessions.mjs server/db/repositories/adminUsers.mjs server/index.mjs tests/server/admin-auth.test.mjs
git commit -m "feat: add admin authentication api"
```

---

### Task 5: Upstream Key And Relay Key Management APIs

**Files:**
- Create: `server/admin/routes/upstreamKeys.mjs`
- Create: `server/admin/routes/proxyKeys.mjs`
- Modify: `server/db/repositories/upstreamKeys.mjs`
- Modify: `server/db/repositories/proxyKeys.mjs`
- Modify: `server/index.mjs`
- Create: `tests/server/key-management.test.mjs`

**Interfaces:**
- Produces: `registerUpstreamKeyRoutes(router, ctx): void`
- Produces: `registerProxyKeyRoutes(router, ctx): void`
- Produces: upstream CRUD functions returning masked keys only.
- Produces: proxy key create route returning plaintext relay key once.

- [ ] **Step 1: Write failing key-management tests**

Test cases:

```js
it('creates upstream keys encrypted and lists only masked key', async () => {
  const app = await createInitializedApp();
  const created = await adminRequest(app, 'POST', '/admin/api/upstream-keys', {
    name: 'cc-main',
    key: 'user_abcdefghijklmnopqrstuvwxyz',
    notes: 'main account'
  });
  expect(created.status).toBe(201);
  expect(created.body.key.maskedKey).toMatch(/^user_/);
  expect(JSON.stringify(created.body)).not.toContain('abcdefghijklmnopqrstuvwxyz');
});

it('creates relay key and only stores hash', async () => {
  const app = await createInitializedApp();
  const created = await adminRequest(app, 'POST', '/admin/api/proxy-keys', {
    name: 'dev-client',
    dailyTokenLimit: 100000,
    monthlyTokenLimit: 1000000,
    allowedModels: ['deepseek/deepseek-v4-flash']
  });
  expect(created.status).toBe(201);
  expect(created.body.plaintextKey.startsWith('sk-ccp_')).toBe(true);
  const list = await adminRequest(app, 'GET', '/admin/api/proxy-keys');
  expect(JSON.stringify(list.body)).not.toContain(created.body.plaintextKey);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/key-management.test.mjs
```

Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement upstream key routes**

Routes:

- `GET /admin/api/upstream-keys`
- `POST /admin/api/upstream-keys`
- `PATCH /admin/api/upstream-keys/:id`
- `DELETE /admin/api/upstream-keys/:id`
- `POST /admin/api/upstream-keys/:id/test`

Validation:

- `key` must match `/user_[a-zA-Z0-9_-]+/`.
- Store `encrypted_key_envelope`, `key_fingerprint = sha256(plaintext).slice(0, 32)`.
- Never return plaintext.

- [ ] **Step 4: Implement proxy key routes**

Routes:

- `GET /admin/api/proxy-keys`
- `POST /admin/api/proxy-keys`
- `PATCH /admin/api/proxy-keys/:id`
- `DELETE /admin/api/proxy-keys/:id`

Validation:

- `dailyTokenLimit` and `monthlyTokenLimit` are positive integers or null.
- `allowedModels` is an array of strings.
- Creation returns `{ ok:true, plaintextKey, key:{ id, name, keyPrefix, ... } }`.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/server/key-management.test.mjs tests/server/admin-auth.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/admin/routes/upstreamKeys.mjs server/admin/routes/proxyKeys.mjs server/db/repositories/upstreamKeys.mjs server/db/repositories/proxyKeys.mjs tests/server/key-management.test.mjs
git commit -m "feat: add key management apis"
```

---

### Task 6: Usage Reservations, Aggregates, Adjustments, And Usage API

**Files:**
- Modify: `server/db/repositories/usage.mjs`
- Create: `server/admin/routes/usage.mjs`
- Modify: `server/index.mjs`
- Create: `tests/server/usage-accounting.test.mjs`

**Interfaces:**
- Produces: `reserveTokens(db, { requestId, proxyKeyId, requestedTokens, period }): ReservationResult`
- Produces: `settleReservation(db, requestId, settledTokens): void`
- Produces: `releaseReservation(db, requestId): void`
- Produces: `expireOldReservations(db, olderThanIso): number`
- Produces: `recordUsageEvent(db, event): void`
- Produces: `queryUsage(db, filters): { rows, total }`
- Produces: `exportUsageCsv(db, filters): string`

- [ ] **Step 1: Write failing usage tests**

Tests:

```js
it('atomically reserves tokens and rejects over limit', () => {
  const db = memoryDb();
  const proxyKeyId = insertProxyKeyFixture(db, { dailyTokenLimit: 1000 });
  const first = reserveTokens(db, { requestId: 'r1', proxyKeyId, requestedTokens: 800, period: 'day' });
  expect(first.ok).toBe(true);
  const second = reserveTokens(db, { requestId: 'r2', proxyKeyId, requestedTokens: 300, period: 'day' });
  expect(second.ok).toBe(false);
  expect(second.errorCode).toBe('quota_exceeded');
});

it('uses adjustments for current quota and raw aggregates for analytics', () => {
  const db = memoryDb();
  const proxyKeyId = insertProxyKeyFixture(db, { dailyTokenLimit: 1000 });
  recordUsageEvent(db, usageFixture({ proxyKeyId, totalTokens: 700 }));
  addUsageAdjustment(db, { proxyKeyId, periodType: 'day', periodStart: todayBucket(), offsetTokens: -500, reason: 'reset' });
  expect(getAdjustedUsage(db, { proxyKeyId, periodType: 'day' })).toBe(200);
  expect(queryUsage(db, { bucket: 'day' }).rows[0].total_tokens).toBe(700);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/usage-accounting.test.mjs
```

Expected: FAIL because usage functions are missing.

- [ ] **Step 3: Implement reservation and aggregate logic**

Rules:

- `reserveTokens` starts `BEGIN IMMEDIATE`.
- It computes `adjusted_usage + active_reserved + requestedTokens`.
- It inserts reservation only if the result is within daily/monthly limits.
- `settleReservation` updates status to `settled`.
- `releaseReservation` updates status to `released`.
- Cleanup uses `expired`.
- `recordUsageEvent` upserts `usage_hourly` and `usage_daily`.
- CSV quoting doubles quotes and wraps cells containing comma, quote, CR, or LF.

- [ ] **Step 4: Implement usage API**

Routes:

- `GET /admin/api/usage`
- `GET /admin/api/usage/export`

Allowed sort fields:

```js
['created_at', 'bucket_start', 'total_tokens', 'request_count', 'error_count', 'avg_duration_ms']
```

Default sort:

- aggregate rows: `bucket_start desc`
- recent diagnostics: `created_at desc`

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/server/usage-accounting.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/db/repositories/usage.mjs server/admin/routes/usage.mjs tests/server/usage-accounting.test.mjs
git commit -m "feat: add usage accounting"
```

---

### Task 7: Extract Existing Proxy And Add Relay-Key Request Flow

**Files:**
- Create: `server/proxy/legacy.mjs`
- Create: `server/proxy/relay.mjs`
- Create: `server/proxy/models.mjs`
- Modify: `server/index.mjs`
- Keep: `proxy.mjs` as a compatibility shim importing `server/index.mjs` or remove it only after scripts no longer reference it.
- Create: `tests/server/proxy-relay.test.mjs`

**Interfaces:**
- Produces: `createLegacyProxyHandlers(deps): { handleChatCompletions, handleMessages, handleModels }`
- Produces: `createRelayProxyHandlers(ctx): { handleChatCompletions, handleMessages, handleModels }`
- Consumes: key repositories, usage reservations, usage aggregates, security decrypt.

- [ ] **Step 1: Write failing relay proxy tests**

Use fake upstream fetch injection:

```js
it('accepts relay key, selects upstream key, and records usage', async () => {
  const upstreamCalls = [];
  const app = await createInitializedApp({
    fetch: async (url, init) => {
      upstreamCalls.push({ url, init });
      return fakeCcSseResponse({ inputTokens: 10, outputTokens: 20, cachedInputTokens: 3 });
    }
  });
  await addEncryptedUpstreamKey(app, 'user_upstream_one');
  const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
  const res = await request(app, 'POST', '/v1/chat/completions', {
    model: 'deepseek/deepseek-v4-flash',
    messages: [{ role: 'user', content: 'hello' }],
    stream: false
  }, { Authorization: `Bearer ${relay.plaintextKey}` });
  expect(res.status).toBe(200);
  expect(upstreamCalls[0].init.headers.Authorization).toBe('Bearer user_upstream_one');
  expect(await usageTotal(app.db, relay.id)).toBe(30);
});

it('does not mark upstream limited for proxy-generated zero-output errors', async () => {
  const app = await createInitializedApp({ fetch: async () => fakeZeroOutputCcResponse() });
  const upstreamId = await addEncryptedUpstreamKey(app, 'user_upstream_one');
  const relay = await createRelayKey(app, { dailyTokenLimit: 1000 });
  const res = await request(app, 'POST', '/v1/chat/completions', validBody(), { Authorization: `Bearer ${relay.plaintextKey}` });
  expect(res.status).toBe(429);
  expect(getUpstreamKey(app.db, upstreamId).health_status).toBe('unknown');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/proxy-relay.test.mjs
```

Expected: FAIL because relay handlers are missing.

- [ ] **Step 3: Extract legacy proxy logic**

Move code from `proxy.mjs` into `server/proxy/legacy.mjs` with these changes:

- Replace top-level `CFG` with injected `config`.
- Replace global `fetch` with injected `fetchImpl`.
- Export handler factory instead of starting the server.
- Preserve OpenAI Chat Completions and Anthropic Messages response formats.
- Preserve zero-output, timeout, SSE translation, model fallback, and privacy logging behavior.

- [ ] **Step 4: Implement relay wrapper**

`server/proxy/relay.mjs` must:

- Parse `Authorization`.
- Reject missing/unknown/disabled relay keys with OpenAI/Anthropic-compatible auth errors.
- Check model allowlist.
- Calculate reservation budget:
  `min(maxReservationTokens, outputReserve + inputReserve)`.
- Reserve tokens atomically before selecting upstream.
- Select upstream via `routing_state`.
- Decrypt upstream key.
- Call legacy handler with selected upstream key.
- Settle/release reservation and record usage.
- Update upstream health only from original upstream status.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/server/proxy-relay.test.mjs tests/server/usage-accounting.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add server/proxy server/index.mjs proxy.mjs tests/server/proxy-relay.test.mjs
git commit -m "feat: route proxy traffic through relay keys"
```

---

### Task 8: Quota Provider, Scheduler, And Health Refresh

**Files:**
- Create: `server/quota/provider.mjs`
- Create: `server/scheduler/index.mjs`
- Create: `server/admin/routes/dashboard.mjs`
- Create: `server/admin/routes/settings.mjs`
- Modify: `server/index.mjs`
- Create: `tests/server/quota-scheduler.test.mjs`

**Interfaces:**
- Produces: `refreshUpstreamQuota(ctx, upstreamKeyId): Promise<QuotaRefreshResult>`
- Produces: `createScheduler(ctx): { start(), stop(), runOnce(name) }`
- Produces: `GET /admin/api/dashboard`
- Produces: `GET /admin/api/settings`, `PATCH /admin/api/settings`

- [ ] **Step 1: Write failing quota tests**

Tests:

```js
it('stores successful quota refresh', async () => {
  const app = await createInitializedApp({
    fetch: async () => jsonResponse(200, { total_tokens: 1000, used_tokens: 200, remaining_tokens: 800 })
  });
  const upstreamId = await addEncryptedUpstreamKey(app, 'user_quota');
  const result = await refreshUpstreamQuota(app.ctx, upstreamId);
  expect(result.ok).toBe(true);
  const row = getUpstreamKey(app.db, upstreamId);
  expect(row.quota_status).toBe('success');
  expect(row.quota_remaining_tokens).toBe(800);
});

it('keeps last quota snapshot on failure', async () => {
  const app = await createInitializedApp({ fetch: async () => jsonResponse(500, { error: 'fail' }) });
  const upstreamId = await addUpstreamWithQuota(app, { remaining: 800 });
  const result = await refreshUpstreamQuota(app.ctx, upstreamId);
  expect(result.ok).toBe(false);
  const row = getUpstreamKey(app.db, upstreamId);
  expect(row.quota_status).toBe('failed');
  expect(row.quota_remaining_tokens).toBe(800);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/server/quota-scheduler.test.mjs
```

Expected: FAIL because quota provider is missing.

- [ ] **Step 3: Implement quota provider**

Provider behavior:

- Try configured provider endpoint if present in settings.
- Try known/probed endpoint candidates under `config.apiBase`.
- Accept response shapes with `total_tokens`, `used_tokens`, `remaining_tokens`, or nested `quota`.
- On unknown shape, return `{ ok:false, status:'failed', message:'Quota response was not recognized' }`.
- Never write zero on failure.

- [ ] **Step 4: Implement scheduler**

Scheduler jobs:

- `quota-refresh`: refresh enabled upstream keys when auto refresh is enabled.
- `reservation-cleanup`: expire old `reserved` rows.
- `recent-event-cleanup`: delete diagnostics older than retention setting.

The scheduler must not run in tests unless explicitly started.

- [ ] **Step 5: Implement dashboard/settings APIs**

Dashboard returns:

```js
{
  ok: true,
  kpis: { totalRequests, todayTokens, successRate, availableUpstreamKeys, unknownQuotaKeys, recentErrors },
  tokenTrend: [],
  upstreamQuota: [],
  recentErrors: [],
  recentRequests: []
}
```

- [ ] **Step 6: Run tests**

Run:

```powershell
npm test -- tests/server/quota-scheduler.test.mjs
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add server/quota server/scheduler server/admin/routes/dashboard.mjs server/admin/routes/settings.mjs tests/server/quota-scheduler.test.mjs
git commit -m "feat: add quota refresh and scheduler"
```

---

### Task 9: Frontend Foundation, Design Tokens, Login, And Shell

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.js`
- Create: `web/src/main.jsx`
- Create: `web/src/App.jsx`
- Create: `web/src/styles.css`
- Create: `web/src/lib/api.js`
- Create: `web/src/components/AppShell.jsx`
- Create: `web/src/components/StatusBadge.jsx`
- Create: `web/src/pages/AuthPage.jsx`
- Create: `tests/web/auth-page.test.jsx`

**Interfaces:**
- Consumes admin auth APIs.
- Produces React shell with desktop sidebar, mobile nav, session restore, init/login flows.

- [ ] **Step 1: Write failing frontend auth tests**

Create `tests/web/auth-page.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AuthPage } from '../../web/src/pages/AuthPage.jsx';

describe('AuthPage', () => {
  it('submits login with visible labels and loading state', async () => {
    const login = vi.fn().mockResolvedValue({ ok: true });
    render(<AuthPage mode="login" onLogin={login} />);
    await userEvent.type(screen.getByLabelText('Username'), 'admin');
    await userEvent.type(screen.getByLabelText('Password'), 'pass123456');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(login).toHaveBeenCalledWith({ username: 'admin', password: 'pass123456' });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/web/auth-page.test.jsx
```

Expected: FAIL because frontend files do not exist.

- [ ] **Step 3: Implement Vite app and CSS tokens**

CSS constraints:

- Use CSS variables for background, foreground, muted, border, primary, success, warning, danger.
- Use tabular figures for numeric classes.
- Use `@media (max-width: 768px)` to switch sidebar to compact top navigation.
- No emoji icons.

- [ ] **Step 4: Implement `AuthPage` and `AppShell`**

Auth page fields:

- Username label.
- Password label.
- Show/hide password button with `aria-label`.
- Submit loading state.
- Field/form error output near controls.

App shell:

- Sidebar links: Dashboard, Upstream Keys, Relay Keys, Usage, Settings.
- Active nav state.
- Main content focus target.

- [ ] **Step 5: Run frontend tests and build**

Run:

```powershell
npm test -- tests/web/auth-page.test.jsx
npm run build:web
```

Expected: PASS and Vite writes `dist/` or configured build output.

- [ ] **Step 6: Commit**

```powershell
git add web tests/web/auth-page.test.jsx package.json package-lock.json
git commit -m "feat: add admin frontend shell"
```

---

### Task 10: Frontend Key Management Pages

**Files:**
- Create: `web/src/pages/UpstreamKeysPage.jsx`
- Create: `web/src/pages/RelayKeysPage.jsx`
- Create: `web/src/components/DataTable.jsx`
- Create: `web/src/components/ConfirmDialog.jsx`
- Create: `web/src/components/KeyCreateResult.jsx`
- Modify: `web/src/App.jsx`
- Create: `tests/web/key-pages.test.jsx`

**Interfaces:**
- Consumes `GET/POST/PATCH/DELETE /admin/api/upstream-keys`.
- Consumes `GET/POST/PATCH/DELETE /admin/api/proxy-keys`.
- Produces pages with tables, modals, masked keys, quota unknown display, plaintext relay key shown once.

- [ ] **Step 1: Write failing page tests**

Tests:

```jsx
it('shows upstream quota unknown explicitly', async () => {
  render(<UpstreamKeysPage api={fakeApi({ upstreamKeys: [{ id: 1, name: 'main', maskedKey: 'user_abcd...wxyz', quotaStatus: 'unknown' }] })} />);
  expect(await screen.findByText('Quota unknown')).toBeInTheDocument();
});

it('shows relay plaintext key once after creation', async () => {
  const api = fakeApi({ createProxyKey: { plaintextKey: 'sk-ccp_abc', key: { id: 1, name: 'dev', keyPrefix: 'sk-ccp_ab' } } });
  render(<RelayKeysPage api={api} />);
  await userEvent.click(screen.getByRole('button', { name: 'Create relay key' }));
  expect(await screen.findByText('sk-ccp_abc')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/web/key-pages.test.jsx
```

Expected: FAIL because pages do not exist.

- [ ] **Step 3: Implement reusable table/dialog components**

`DataTable` requirements:

- Accepts `columns`, `rows`, `emptyTitle`, `emptyAction`.
- Wraps table in `overflow-x-auto`.
- Uses `<th scope="col">`.

`ConfirmDialog` requirements:

- Requires explicit confirm button.
- Closes on cancel.
- Uses `role="dialog"`.

- [ ] **Step 4: Implement upstream and relay pages**

Upstream page:

- Columns: Name, Masked key, Health, Quota, Last refresh, Last success, Last error, Actions.
- Actions: Add, Edit, Enable/disable, Delete, Refresh quota, Test.

Relay page:

- Columns: Name, Prefix, Status, Daily limit, Monthly limit, Today/month usage, Allowed models, Last used, Actions.
- Create modal shows plaintext once.
- Reset current period usage uses confirmation.

- [ ] **Step 5: Run tests**

Run:

```powershell
npm test -- tests/web/key-pages.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/pages/UpstreamKeysPage.jsx web/src/pages/RelayKeysPage.jsx web/src/components/DataTable.jsx web/src/components/ConfirmDialog.jsx web/src/components/KeyCreateResult.jsx tests/web/key-pages.test.jsx
git commit -m "feat: add key management pages"
```

---

### Task 11: Frontend Dashboard, Usage Analytics, Settings, And Static Serving

**Files:**
- Create: `web/src/pages/DashboardPage.jsx`
- Create: `web/src/pages/UsagePage.jsx`
- Create: `web/src/pages/SettingsPage.jsx`
- Create: `web/src/components/KpiCard.jsx`
- Create: `web/src/components/TrendChart.jsx`
- Modify: `server/index.mjs`
- Create: `server/http/static.mjs`
- Create: `tests/web/dashboard-usage-settings.test.jsx`
- Create: `tests/server/static-serving.test.mjs`

**Interfaces:**
- Consumes dashboard, usage, settings APIs.
- Produces static file serving for built admin UI.

- [ ] **Step 1: Write failing tests**

Frontend tests:

```jsx
it('renders dashboard kpis and token trend', async () => {
  render(<DashboardPage api={fakeDashboardApi()} />);
  expect(await screen.findByText('Today tokens')).toBeInTheDocument();
  expect(screen.getByText('Available upstream keys')).toBeInTheDocument();
});

it('renders settings environment state without secret values', async () => {
  render(<SettingsPage api={fakeSettingsApi({ encryptionKeyConfigured: true, databasePath: '/app/data/cc-proxy.sqlite' })} />);
  expect(await screen.findByText('/app/data/cc-proxy.sqlite')).toBeInTheDocument();
  expect(screen.queryByText(/user_/)).not.toBeInTheDocument();
});
```

Server static test:

```js
it('serves index.html fallback for admin routes', async () => {
  const app = await createStaticTestApp({ indexHtml: '<div id="root"></div>' });
  const res = await request(app, 'GET', '/admin');
  expect(res.status).toBe(200);
  expect(res.text).toContain('root');
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```powershell
npm test -- tests/web/dashboard-usage-settings.test.jsx tests/server/static-serving.test.mjs
```

Expected: FAIL because pages/static serving are missing.

- [ ] **Step 3: Implement dashboard, usage, settings pages**

Dashboard:

- KPI row.
- Token trend SVG line chart.
- Upstream quota progress list.
- Recent errors and recent requests tables.

Usage:

- Filters for time range, upstream key, relay key, model, endpoint, success/error.
- Aggregate table.
- CSV export link using `/admin/api/usage/export`.

Settings:

- Quota refresh interval.
- Retention.
- Auto quota refresh.
- Model refresh interval.
- Environment state.

- [ ] **Step 4: Implement static serving**

`server/http/static.mjs` exports:

```js
export async function serveStaticOrIndex(req, res, { rootDir, indexPath }) {}
```

Rules:

- Serve files under built web directory.
- Reject path traversal.
- For `/admin` and `/admin/*`, return `index.html`.
- Use correct content types for `.html`, `.js`, `.css`, `.svg`, `.json`.

- [ ] **Step 5: Run tests and build**

Run:

```powershell
npm test -- tests/web/dashboard-usage-settings.test.jsx tests/server/static-serving.test.mjs
npm run build:web
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add web/src/pages/DashboardPage.jsx web/src/pages/UsagePage.jsx web/src/pages/SettingsPage.jsx web/src/components/KpiCard.jsx web/src/components/TrendChart.jsx server/http/static.mjs server/index.mjs tests/web/dashboard-usage-settings.test.jsx tests/server/static-serving.test.mjs
git commit -m "feat: add dashboard analytics and static admin ui"
```

---

### Task 12: Docker, Documentation, Full Verification, And Review

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.dockerignore`
- Modify: `README.md`
- Modify: `README_zh.md`
- Create: `tests/server/full-flow.test.mjs`

**Interfaces:**
- Produces documented env vars: `ENCRYPTION_KEY`, `RELAY_KEY_PEPPER`, `SESSION_SECRET`, `DATABASE_PATH`, `PORT`, `HOST`, `CC_API_BASE`.
- Produces Docker image that serves proxy and admin UI with `/app/data` volume.

- [ ] **Step 1: Write full-flow integration test**

Create `tests/server/full-flow.test.mjs`:

```js
it('runs init, adds upstream, creates relay key, sends proxy request, and updates stats', async () => {
  const app = await createInitializedApp({ fetch: fakeSuccessfulCcFetch });
  await adminRequest(app, 'POST', '/admin/api/upstream-keys', { name: 'main', key: 'user_main_key' });
  const relay = await adminRequest(app, 'POST', '/admin/api/proxy-keys', { name: 'client', dailyTokenLimit: 100000, monthlyTokenLimit: 1000000, allowedModels: [] });
  const response = await request(app, 'POST', '/v1/chat/completions', validBody(), { Authorization: `Bearer ${relay.body.plaintextKey}` });
  expect(response.status).toBe(200);
  const dashboard = await adminRequest(app, 'GET', '/admin/api/dashboard');
  expect(dashboard.body.kpis.todayTokens).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run full test suite**

Run:

```powershell
npm test
```

Expected: PASS.

- [ ] **Step 3: Update Dockerfile**

Dockerfile requirements:

- Use `node:22-alpine`.
- Install production dependencies.
- Run `npm run build`.
- Copy `server/`, `web/`, `dist/`, `package*.json`.
- Create `/app/data`.
- Expose `3050`.
- Healthcheck `wget --spider http://127.0.0.1:3050/health`.
- Start `node server/index.mjs`.

- [ ] **Step 4: Update docker-compose**

Compose requirements:

```yaml
services:
  proxy:
    build: .
    ports:
      - "${PROXY_PORT:-3050}:3050"
    environment:
      PORT: "3050"
      DATABASE_PATH: "/app/data/cc-proxy.sqlite"
      ENCRYPTION_KEY: "${ENCRYPTION_KEY}"
      SESSION_SECRET: "${SESSION_SECRET}"
      RELAY_KEY_PEPPER: "${RELAY_KEY_PEPPER:-}"
    volumes:
      - cc-proxy-data:/app/data
    restart: unless-stopped
volumes:
  cc-proxy-data:
```

- [ ] **Step 5: Update README files**

Document:

- How to generate `ENCRYPTION_KEY`:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

- Admin init URL: `http://127.0.0.1:3050/admin`.
- Relay request example using `sk-ccp_...`.
- Docker volume path.
- Security note: upstream keys encrypted, relay keys shown once.

- [ ] **Step 6: Build and smoke test**

Run:

```powershell
npm run build
npm test
docker build -t commandcode-proxy:latest .
```

Expected: all commands exit 0.

- [ ] **Step 7: Commit**

```powershell
git add Dockerfile docker-compose.yml .dockerignore README.md README_zh.md tests/server/full-flow.test.mjs
git commit -m "docs: finalize admin deployment flow"
```

- [ ] **Step 8: Request final code review**

Use `superpowers:requesting-code-review` with:

- Base: commit before Task 1.
- Head: current commit.
- Requirements: `docs/superpowers/specs/2026-07-08-commandcode-proxy-admin-design.md`.

---

## Plan Self-Review

Spec coverage:

- Modular single service: Tasks 1, 7, 11, 12.
- SQLite schema and `/app/data`: Tasks 2 and 12.
- Encryption/HMAC/password/session safety: Tasks 3 and 4.
- Upstream and relay key management: Task 5.
- Token reservations, adjusted usage, analytics, CSV: Task 6.
- Relay proxy flow, round-robin, health semantics: Task 7.
- Quota provider and scheduler: Task 8.
- React/Vite Data-Dense Dashboard UI: Tasks 9, 10, 11.
- Docker/docs/full verification: Task 12.

Placeholder scan:

- The plan avoids empty markers, vague error handling, and unspecified route names.
- Every task has exact file paths, interfaces, test commands, and commit commands.

Type consistency:

- `proxy_keys` is used for downstream relay keys in database modules.
- `upstream_keys` is used for encrypted `user_...` keys.
- `usage_reservations`, `usage_adjustments`, and `routing_state` names match the approved spec.
