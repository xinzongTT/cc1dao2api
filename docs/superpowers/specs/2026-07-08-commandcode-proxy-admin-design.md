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
- `encrypted_key_envelope`
- `key_fingerprint`
- `admin_enabled`
- `health_status`
- `quota_status`
- `quota_total_tokens`
- `quota_used_tokens`
- `quota_remaining_tokens`
- `quota_reset_at`
- `last_quota_checked_at`
- `last_success_at`
- `last_error_at`
- `last_error_message`
- `notes`
- `created_at`
- `updated_at`

The UI never receives plaintext upstream keys. It displays masked values such as `user_abcd...wxyz`.

Status fields are deliberately split:

- `admin_enabled`: manual routing switch controlled by the admin.
- `health_status`: runtime health state, one of `healthy`, `invalid`, `limited`, `degraded`, `unknown`.
- `quota_status`: quota refresh state, one of `success`, `failed`, `unknown`, `stale`.

Manual disablement must not erase `health_status` or `quota_status`; re-enabling restores the key to routing only if health allows it.

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

Plaintext `sk-ccp_...` keys are shown only once when created. SQLite stores only HMAC hashes.

Relay key requirements:

- Format: `sk-ccp_` plus at least 32 bytes of cryptographically random entropy encoded URL-safely.
- `key_hash`: `HMAC-SHA256(RELAY_KEY_PEPPER, plaintext_key)`.
- `RELAY_KEY_PEPPER` is an environment secret. If absent, derive it from `ENCRYPTION_KEY` with a distinct HKDF context.
- Compare hashes with constant-time comparison.
- `key_prefix` is for display and lookup hints only, never for authentication.

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
- `default_reservation_tokens`
- `default_input_reservation_tokens`
- `max_reservation_tokens`

Sensitive values should stay in environment variables.

### `routing_state`

Stores global routing cursors.

Fields:

- `name`
- `cursor_value`
- `updated_at`

For version 1, use `name = 'upstream_round_robin'`. Selecting an upstream key and incrementing this cursor must happen in a single SQLite transaction to keep round-robin behavior stable under concurrent requests.

### `usage_reservations`

Tracks in-flight relay-key token reservations.

Fields:

- `request_id`
- `proxy_key_id`
- `reserved_tokens`
- `settled_tokens`
- `status`
- `created_at`
- `settled_at`

Statuses:

- `reserved`
- `settled`
- `released`
- `expired`

Reservations protect daily/monthly token limits from concurrent streaming requests that finish later with final usage.

### `usage_adjustments`

Tracks admin-initiated usage resets without destroying historical aggregates.

Fields:

- `id`
- `proxy_key_id`
- `period_type`
- `period_start`
- `offset_tokens`
- `reason`
- `created_at`

Resetting current period usage creates an adjustment/offset. It must not delete `usage_hourly` or `usage_daily` rows.

Current-period quota displays and limit checks use adjusted usage:

```text
adjusted_usage = max(0, aggregate_total + sum(usage_adjustments.offset_tokens))
```

Usage analytics and CSV export default to raw historical aggregates and include adjustment rows or reset markers when the selected range contains resets.

### Indexes and Constraints

Required constraints:

- Unique `admin_users.username`.
- Unique `upstream_keys.key_fingerprint`.
- Unique `proxy_keys.key_hash`.
- Composite unique bucket key on `usage_hourly` and `usage_daily`.

Required indexes:

- `usage_events_recent.created_at`.
- `usage_events_recent.proxy_key_id`.
- `usage_events_recent.upstream_key_id`.
- `usage_hourly.bucket_start`.
- `usage_daily.bucket_start`.
- `usage_reservations.proxy_key_id, status`.

## Key Security

Upstream `user_...` keys:

- Must be encrypted at rest.
- Use `ENCRYPTION_KEY` from the environment.
- Encrypt with AES-256-GCM.
- Store a versioned envelope in `encrypted_key_envelope`, formatted as `enc:v1:<key_id>:<iv_b64url>:<tag_b64url>:<ciphertext_b64url>`.
- `ENCRYPTION_KEY` must decode to exactly 32 random bytes from base64url or base64. Other formats are invalid.
- `key_id` defaults to `default` in version 1 and exists to allow later key rotation.
- Store a non-sensitive fingerprint for deduplication and display.
- Decrypt only in memory for the active upstream request.
- If `ENCRYPTION_KEY` is missing or invalid, the service may still start for read-only inspection, but adding or decrypting upstream keys must fail clearly and proxy routing must report no decryptable upstream keys.

Downstream `sk-ccp_...` keys:

- Generate server-side.
- Store only a secure hash.
- Show plaintext once after creation.
- Display only the prefix in the UI.

Admin sessions:

- Use secure cookie sessions.
- Cookies must be `HttpOnly` and `SameSite=Lax`.
- Enable `Secure` when configured for HTTPS.
- Passwords use a memory-hard hash such as Node `crypto.scrypt` or Argon2id. If only built-in dependencies are preferred, use `scrypt` with per-user salt.
- Login success rotates the session identifier.
- Login failures are rate-limited by username and client IP.
- Mutating admin routes must validate either a CSRF token or strict `Origin`/`Host` checks.
- Session signing secret must come from a stable environment secret or be generated once and stored locally; it must not change on every restart.

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
4. Check `allowed_models_json` if configured.
5. Estimate a reservation budget for token limit enforcement.
6. In one SQLite transaction, check daily/monthly token limits including adjusted settled usage plus active reservations and insert the `usage_reservations` row.
7. If the transaction cannot reserve capacity, reject the request before selecting an upstream key.
8. Select an enabled and healthy upstream key using round-robin in a transaction.
9. Decrypt the upstream `user_...` key for this request only.
10. Reuse the current OpenAI/Anthropic compatibility pipeline.
11. Forward to Command Code with the selected upstream key.
12. Return OpenAI/Anthropic-compatible responses.
13. Settle or release the reservation based on final usage and outcome.
14. Record a recent event and update hourly/daily aggregates.
15. Update upstream health status based on the original upstream result.

Token limit accounting:

- Preflight uses settled period usage plus active reservations.
- Limit calculation and reservation insert must be atomic, using `BEGIN IMMEDIATE` or equivalent write-lock behavior so concurrent requests cannot all pass the same preflight check.
- If no upstream route/decrypt/upstream call starts after reservation, release or roll back the reservation before returning.
- Reservation budget covers at least requested output capacity plus input capacity.
- Output reserve uses the request's `max_tokens` when present; if missing, use `default_reservation_tokens`.
- Input reserve uses an input-token estimate when available; if estimation is unavailable, use `default_input_reservation_tokens`.
- `default_reservation_tokens` defaults to `8192`.
- `default_input_reservation_tokens` defaults to `4096`.
- `max_reservation_tokens` defaults to `200000`; calculated reservations are clamped to this value.
- If the reservation budget exceeds remaining adjusted quota, reject with an OpenAI/Anthropic-compatible 429 before calling upstream.
- Streaming requests reserve before the upstream call and settle when the final usage event is parsed.
- Non-streaming requests reserve before the upstream call and settle after the response usage is known.
- If the upstream call fails before usage is known, release the reservation and record an error event with zero settled tokens unless upstream usage was captured.
- If the client disconnects before final usage and the request handler can still update SQLite, settle with captured usage if available; otherwise mark the reservation `released` and record the disconnect.
- Only the periodic cleanup job marks old `reserved` rows as `expired`; `expired` is for abandoned rows left by process crashes or hard failures.
- Usage reset actions apply `usage_adjustments` offsets and must be considered in limit calculations.

Routing:

- `/v1/chat/completions` uses the relay key flow.
- `/v1/messages` uses the relay key flow.
- `/v1/models` uses the first available upstream key to fetch live models, otherwise falls back to built-in models.
- `/health` remains unauthenticated.

Compatibility option:

- `allowDirectUserKey=false` by default.
- If enabled, old clients may still pass `user_...` directly.
- Direct upstream-key requests are not controlled by relay-key quotas.
- Direct mode requests are still recorded with `proxy_key_id = null`.
- Admin UI must label these rows as direct upstream usage so dashboard totals explain quota bypasses clearly.

## Upstream Key Selection

Use round-robin for version 1:

- Only select keys with `admin_enabled = true` and routeable `health_status`.
- Rotate evenly across available keys using `routing_state.name = 'upstream_round_robin'`.
- The key selection query and cursor update must be atomic in SQLite.
- Do not implement weighted routing in version 1.
- Do not implement automatic multi-key retry for streaming responses in version 1, because duplicate upstream calls can create inconsistent token accounting and duplicated generation.

Status handling:

- `healthy`: available for routing when `admin_enabled = true`.
- `unknown`: available for routing when `admin_enabled = true`; this is the default before first test/traffic result.
- `invalid`: set when the original upstream response returns authentication failure such as 401; exclude from routing.
- `limited`: set when the original upstream response returns quota/rate-limit-like errors such as 402 or true upstream 429; exclude until manual recovery or successful refresh/test.
- `degraded`: set after repeated original upstream 5xx/network failures; exclude from routing until manual recovery or successful test.
- Internal proxy compatibility errors such as zero-output 429, stream idle timeout 429, or client disconnect must not mark an upstream key as `limited` unless the original upstream response proves it.
- `admin_enabled = false` manually removes a key from routing without changing `health_status`.

Session mapping:

- Existing per-key Command Code session/fingerprint behavior should be keyed by `upstream_key_id`.
- Client-provided session headers may still be honored only after validation, but they must not let one downstream relay key force session identity for unrelated upstream keys.
- If the implementation preserves client session override, recent diagnostics should record that override was used without logging the raw session header.

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

Visual/product constraints:

- Use a persistent left sidebar on desktop and a compact top/mobile navigation on small screens.
- Prioritize dense tables and scannable KPI rows over marketing-style hero sections.
- Do not nest cards inside cards.
- Use semantic status colors consistently: success/healthy, warning/stale, danger/invalid, neutral/unknown.
- Provide empty states for no upstream keys, no relay keys, no usage, and quota unknown.
- Destructive actions use confirmation dialogs and are visually separated from normal row actions.
- Numeric tables use tabular figures to prevent layout shift.
- Charts must include visible numeric summaries; color must not be the only signal.

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

Admin routes require authenticated admin session except the initialization route.

Initialization rule:

- `POST /admin/api/auth/init` is anonymous only while `admin_users` is empty.
- The handler must check emptiness and insert the first admin in a single transaction.
- Once an admin exists, it returns `409` and cannot overwrite the existing admin.
- The created admin's `created_at` records initialization time.

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
- `GET /admin/api/usage/export`
- `GET /admin/api/settings`
- `PATCH /admin/api/settings`

`GET /admin/api/usage` supports:

- `from`
- `to`
- `bucket=hour|day`
- `group_by=proxy_key|upstream_key|model|endpoint`
- `proxy_key_id`
- `upstream_key_id`
- `model`
- `endpoint`
- `success`
- `limit`
- `offset`
- `sort`

Allowed `sort` fields:

- `created_at`
- `bucket_start`
- `total_tokens`
- `request_count`
- `error_count`
- `avg_duration_ms`

Default sort is `bucket_start desc` for aggregate usage and `created_at desc` for recent diagnostics. Sort fields must be allowlisted before being used in SQL.

CSV export uses `GET /admin/api/usage/export` with the same filters and a bounded maximum range/row count.

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
- Original upstream 401 errors mark keys invalid.
- Original upstream 402/429 errors mark keys limited.
- Proxy-generated compatibility 429 errors do not mark upstream keys limited.
- Repeated original upstream 5xx/network errors mark keys degraded.
- Init can only create the first admin and cannot be replayed after an admin exists.
- Admin mutating routes reject missing/invalid CSRF or Origin/Host validation.
- Wrong `ENCRYPTION_KEY` fails decryption clearly and does not return corrupted secrets.
- In-flight token reservations must be settled, released, or expired; they must not remain active forever.
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
- Encryption envelope parsing and wrong-key failure.
- Missing `ENCRYPTION_KEY` behavior.
- Round-robin upstream selection.
- Round-robin cursor update inside a transaction.
- Relay key daily/monthly quota checks.
- Usage reservation create/settle/release/expire behavior.
- Usage reset adjustment behavior.
- Usage aggregate updates.
- Quota refresh success/failure state updates.
- Password hashing and session rotation helpers.

Backend integration tests:

- Admin init succeeds exactly once and then returns 409.
- Login rate limiting and session restore.
- Admin mutating routes reject missing CSRF or invalid Origin/Host.
- `/v1/chat/completions` with valid relay key.
- `/v1/messages` with valid relay key.
- `/v1/models` with available upstream key and fallback.
- Disabled/unknown relay key rejection.
- Model allowlist rejection.
- Concurrent requests cannot exceed daily/monthly relay key limits beyond reservation policy.
- Streaming final usage settles the reservation and updates aggregates.
- Client disconnect releases or settles reservations according to captured usage.
- Zero-output and stream-timeout compatibility errors do not mark upstream keys limited unless original upstream status requires it.
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
- Round-robin selection remains stable under concurrent requests.
- Daily/monthly token limits account for in-flight streaming requests through reservations.
- Usage is aggregated by hour/day and visible in the dashboard.
- Quota refresh failures are visible but do not stop proxy traffic.
- Init cannot overwrite an existing admin.
- Proxy-generated timeout/zero-output errors do not incorrectly mark upstream keys limited.
- Secrets are never exposed in API responses, logs, or UI tables.
- Docker persists SQLite data under `/app/data`.
