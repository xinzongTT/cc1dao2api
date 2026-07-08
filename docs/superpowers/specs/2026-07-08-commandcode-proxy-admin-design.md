# CommandCode Proxy Admin Design

Date: 2026-07-08
Status: Approved for spec review

## Goal

Turn `commandcode-proxy` into a personal/small-team relay station with:

- A React/Vite admin panel.
- SQLite persistence.
- Single admin login.
- Multiple encrypted upstream `user_...` Command Code keys.
- Multiple downstream relay keys (`sk-ccp_...`) with independent token limits.
- Round-robin upstream key selection.
- Automatic upstream quota refresh through a pluggable `quotaProvider`.
- Token usage aggregation and recent request diagnostics.

The first version is not a public SaaS platform. It does not include user registration, recharge/payment, multi-admin roles, tenant billing, or complex weighted routing.

## Existing Project Context

The current repository is a single-file Node.js reverse proxy:

- Runtime: native Node `http`.
- Entry: `proxy.mjs`.
- Persistence: none.
- Current key mode: clients pass upstream `user_...` keys directly in `Authorization`.
- Current routes: `/v1/chat/completions`, `/v1/messages`, `/v1/models`, `/health`.
- Current strengths to preserve: OpenAI/Anthropic compatibility, SSE translation, upstream timeout handling, zero-output handling, model fallback behavior, privacy-aware logs.

The implementation should split the large single file into modules while keeping one deployable Node service.

## Chosen Approach

Use a modular single service:

- One Node process serves both proxy API and admin API.
- React/Vite admin UI builds to static assets served by the same Node service.
- SQLite stores admin state, upstream keys, relay keys, quota snapshots, recent events, and usage aggregates.
- Docker keeps a single service and mounts `/app/data` for persistence.

This keeps deployment simple while avoiding the maintainability problems of continuing to grow `proxy.mjs`.

## Architecture

Proposed structure:

```text
server/
  index.mjs
  config/
  db/
  crypto/
  proxy/
  admin/
  quota/
  scheduler/
web/
  src/
  index.html
  vite.config.js
data/
```

Module responsibilities:

- `server/index.mjs`: boot configuration, SQLite migration, HTTP server, route registration, static UI serving.
- `server/proxy/`: existing OpenAI and Anthropic request conversion, SSE translation, CC forwarding, error mapping.
- `server/admin/`: login, admin session, upstream key CRUD, relay key CRUD, usage query, quota refresh APIs.
- `server/db/`: SQLite connection, migrations, repository functions.
- `server/crypto/`: AES-GCM encryption/decryption for upstream keys; hash helpers for relay keys.
- `server/quota/`: pluggable quota refresh adapter.
- `server/scheduler/`: periodic quota refresh, health refresh, aggregate maintenance, recent event cleanup.
- `web/`: React/Vite admin panel.

## Storage

Default database path:

```text
/app/data/cc-proxy.sqlite
```

Docker should mount `/app/data` as a persistent volume. A config/env override may exist, but the default path must work without extra setup.

## Data Model

### `admin_users`

Single admin account.

Fields:

- `id`
- `username`
- `password_hash`
- `password_salt`
- `created_at`
- `last_login_at`

### `upstream_keys`

Command Code upstream `user_...` keys.

Fields:

- `id`
- `name`
- `encrypted_key`
- `key_fingerprint`
- `status`
- `last_quota_status`
- `quota_total_tokens`
- `quota_used_tokens`
- `quota_remaining_tokens`
- `quota_reset_at`
- `last_quota_checked_at`
- `last_success_at`
- `last_error_at`
- `last_error_message`
- `round_robin_cursor`
- `notes`
- `created_at`
- `updated_at`

The UI never receives plaintext upstream keys. It displays masked values such as `user_abcd...wxyz`.

### `proxy_keys`

Downstream relay keys used by clients.

Fields:

- `id`
- `name`
- `key_hash`
- `key_prefix`
- `status`
- `daily_token_limit`
- `monthly_token_limit`
- `allowed_models_json`
- `last_used_at`
- `notes`
- `created_at`
- `updated_at`

Plaintext `sk-ccp_...` keys are shown only once when created. SQLite stores only hashes.

### `usage_events_recent`

Recent request diagnostics.

Fields:

- `request_id`
- `proxy_key_id`
- `upstream_key_id`
- `endpoint`
- `model`
- `status_code`
- `success`
- `input_tokens`
- `output_tokens`
- `cached_tokens`
- `duration_ms`
- `error_type`
- `created_at`

Do not store prompts, request bodies, response bodies, or full secrets.

### `usage_hourly` and `usage_daily`

Aggregated usage by time bucket, upstream key, proxy key, model, and endpoint.

Fields:

- `bucket_start`
- `upstream_key_id`
- `proxy_key_id`
- `model`
- `endpoint`
- `request_count`
- `success_count`
- `error_count`
- `input_tokens`
- `output_tokens`
- `cached_tokens`
- `total_tokens`
- `avg_duration_ms`

### `settings`

Runtime settings that are safe to store.

Examples:

- `quota_refresh_interval_ms`
- `recent_event_retention_days`
- `auto_quota_refresh_enabled`
- `model_refresh_interval_ms`
- `quota_provider_mode`

Sensitive values should stay in environment variables.

## Key Security

Upstream `user_...` keys:

- Must be encrypted at rest.
- Use `ENCRYPTION_KEY` from the environment.
- Encrypt with AES-GCM.
- Store ciphertext, IV, auth tag, and a non-sensitive fingerprint.
- Decrypt only in memory for the active upstream request.

Downstream `sk-ccp_...` keys:

- Generate server-side.
- Store only a secure hash.
- Show plaintext once after creation.
- Display only the prefix in the UI.

Admin sessions:

- Use secure cookie sessions.
- Cookies must be `HttpOnly` and `SameSite=Lax`.
- Enable `Secure` when configured for HTTPS.

Logging:

- Never log full upstream keys, relay keys, prompts, messages, request bodies, or response bodies.
- Existing privacy-aware logging behavior must be preserved.

## Proxy Request Flow

Clients call:

```http
Authorization: Bearer sk-ccp_xxx
```

Flow:

1. Parse and hash the relay key.
2. Look up `proxy_keys`.
3. Reject disabled or unknown relay keys.
4. Check daily/monthly token limits.
5. Check `allowed_models_json` if configured.
6. Select an enabled and healthy upstream key using round-robin.
7. Decrypt the upstream `user_...` key for this request only.
8. Reuse the current OpenAI/Anthropic compatibility pipeline.
9. Forward to Command Code with the selected upstream key.
10. Return OpenAI/Anthropic-compatible responses.
11. Record a recent event and update hourly/daily aggregates.
12. Update upstream health status based on the result.

Routing:

- `/v1/chat/completions` uses the relay key flow.
- `/v1/messages` uses the relay key flow.
- `/v1/models` uses the first available upstream key to fetch live models, otherwise falls back to built-in models.
- `/health` remains unauthenticated.

Compatibility option:

- `allowDirectUserKey=false` by default.
- If enabled, old clients may still pass `user_...` directly.
- Direct upstream-key requests are not controlled by relay-key quotas.

## Upstream Key Selection

Use round-robin for version 1:

- Only select `enabled` and healthy upstream keys.
- Rotate evenly across available keys.
- Do not implement weighted routing in version 1.
- Do not implement automatic multi-key retry for streaming responses in version 1, because duplicate upstream calls can create inconsistent token accounting and duplicated generation.

Status handling:

- `invalid`: set when upstream returns authentication failure such as 401; exclude from routing.
- `limited`: set when upstream returns quota/rate-limit-like errors such as 402 or 429; exclude until manual recovery or successful refresh/test.
- `degraded`: set after repeated 5xx/network failures; deprioritize or exclude based on implementation threshold.
- `enabled`: available for routing.
- `disabled`: manually disabled by admin.

## Quota Refresh

Quota is provided by a pluggable `quotaProvider`.

Behavior:

- Admin can refresh one upstream key manually.
- Scheduler can refresh all enabled upstream keys periodically.
- Provider attempts to call known or detected Command Code quota endpoints.
- If a response is recognized, update quota fields.
- If refresh fails, store failure status and error message.
- Never overwrite a previous successful quota value with zero after a failed refresh.
- If no refresh has ever succeeded, display quota as unknown.
- Quota refresh failure must not block proxy requests.

Quota UI should show:

- Last successful upstream quota snapshot.
- Local accumulated token usage from proxy traffic.
- State confidence: success, failed, unknown, stale.

## Admin UI

Use React + Vite. The design direction follows `ui-ux-pro-max` recommendations for a dense operational dashboard:

- Data-dense dashboard layout.
- Light and dark mode support.
- KPI cards, tables, trend charts, progress/bullet indicators.
- SVG/Lucide-style icons, no emoji structural icons.
- Visible focus states and keyboard navigation.
- Loading states for async operations.
- Field-level validation errors.
- Responsive behavior for 375px, 768px, 1024px, and 1440px widths.

Pages:

### Login and Initialization

- If no admin exists, show initialization flow.
- Otherwise show login.
- Password input supports show/hide.
- Failed login gives clear field or form-level error.

### Dashboard

KPI cards:

- Total requests.
- Today tokens.
- Success rate.
- Available upstream keys.
- Unknown-quota upstream keys.
- Recent errors.

Charts/lists:

- Today token trend.
- Upstream key quota/usage progress.
- Recent errors.
- Recent request diagnostics.

### Upstream Key Management

Primary page for `user_...` key pool.

Table columns:

- Name.
- Masked key.
- Status.
- Routing enabled/disabled.
- Quota total/used/remaining.
- Last quota refresh time.
- Last success.
- Last error.
- Notes.
- Actions.

Actions:

- Add key.
- Edit name/notes.
- Enable/disable.
- Delete.
- Refresh quota now.
- Test connectivity.

Quota unknown must be shown explicitly and must not be represented as zero.

### Relay Key Management

Manage downstream `sk-ccp_...` keys.

Table columns:

- Name.
- Prefix.
- Status.
- Daily token limit.
- Monthly token limit.
- Today/month usage.
- Allowed models.
- Last used.
- Actions.

Actions:

- Create key.
- Show plaintext once on create.
- Enable/disable.
- Edit limits and model allowlist.
- Reset current period usage.
- Delete.

### Usage Analytics

Filters:

- Time range.
- Upstream key.
- Relay key.
- Model.
- Endpoint.
- Success/error.

Views:

- Hourly/daily token trend.
- Model distribution.
- Upstream distribution.
- Error distribution.
- Aggregate table.
- CSV export.

### Settings

Settings:

- Quota refresh interval.
- Recent event retention period.
- Auto quota refresh enabled/disabled.
- Model refresh interval.

Environment state:

- `ENCRYPTION_KEY` configured or missing.
- Database path.
- App version.

Sensitive values must not be displayed.

## Admin API

All admin routes require authenticated admin session.

Suggested route groups:

- `POST /admin/api/auth/init`
- `POST /admin/api/auth/login`
- `POST /admin/api/auth/logout`
- `GET /admin/api/session`
- `GET /admin/api/dashboard`
- `GET /admin/api/upstream-keys`
- `POST /admin/api/upstream-keys`
- `PATCH /admin/api/upstream-keys/:id`
- `DELETE /admin/api/upstream-keys/:id`
- `POST /admin/api/upstream-keys/:id/refresh-quota`
- `POST /admin/api/upstream-keys/:id/test`
- `GET /admin/api/proxy-keys`
- `POST /admin/api/proxy-keys`
- `PATCH /admin/api/proxy-keys/:id`
- `DELETE /admin/api/proxy-keys/:id`
- `GET /admin/api/usage`
- `GET /admin/api/settings`
- `PATCH /admin/api/settings`

Admin API error format:

```json
{
  "ok": false,
  "error": {
    "code": "string",
    "message": "string"
  }
}
```

Proxy API errors must remain compatible with OpenAI/Anthropic formats.

## Error Handling

Backend:

- Startup fails clearly if SQLite migration fails.
- Adding upstream keys fails clearly if `ENCRYPTION_KEY` is missing.
- Quota refresh failure stores a visible error and keeps the previous successful snapshot.
- 401 upstream errors mark keys invalid.
- 402/429 upstream errors mark keys limited.
- Repeated 5xx/network errors mark keys degraded.
- Admin API never leaks secret values.

Frontend:

- Field validation appears near the field.
- List and chart loading states use skeletons/spinners for operations over 300ms.
- Destructive actions require confirmation.
- Failed refresh/test actions show retry paths.
- Tables remain usable on mobile through horizontal scroll or card layout.

## Testing

Backend unit tests:

- Config loading.
- Relay key generation and hashing.
- AES-GCM encryption/decryption.
- Missing `ENCRYPTION_KEY` behavior.
- Round-robin upstream selection.
- Relay key daily/monthly quota checks.
- Usage aggregate updates.
- Quota refresh success/failure state updates.

Backend integration tests:

- `/v1/chat/completions` with valid relay key.
- `/v1/messages` with valid relay key.
- `/v1/models` with available upstream key and fallback.
- Disabled/unknown relay key rejection.
- Model allowlist rejection.
- Usage event and aggregate creation.
- Upstream error mapping and health marking.

Frontend verification:

- Admin initialization.
- Login/logout/session restore.
- Upstream key add/edit/disable/delete.
- Quota refresh success and failure display.
- Relay key creation with plaintext shown once.
- Usage filters and CSV export.
- Responsive checks at 375px, 768px, 1024px, 1440px.
- Light/dark contrast and keyboard focus states.

Build/deploy verification:

- `npm test`.
- `npm run build`.
- Docker build.
- Start service and verify `/health`.
- Manual OpenAI-compatible request through `sk-ccp_...` updates admin stats.

## Out of Scope for Version 1

- Public registration.
- Multiple admin roles.
- Downstream customer accounts.
- Payment/recharge.
- SaaS tenant isolation.
- Weighted upstream routing.
- Automatic streaming retry across upstream keys.
- Full prompt/body logging.
- Postgres/MySQL deployment.

## Acceptance Criteria

- Admin can initialize and log in.
- Admin can add multiple encrypted upstream `user_...` keys.
- Admin can view each upstream key's quota state, local usage, health, and last error.
- Admin can create multiple downstream `sk-ccp_...` keys with token limits.
- Clients can call OpenAI/Anthropic-compatible endpoints using relay keys.
- Requests are distributed across enabled upstream keys by round-robin.
- Usage is aggregated by hour/day and visible in the dashboard.
- Quota refresh failures are visible but do not stop proxy traffic.
- Secrets are never exposed in API responses, logs, or UI tables.
- Docker persists SQLite data under `/app/data`.
