# CommandCode Proxy

Single-service CommandCode relay with an admin UI, encrypted upstream keys, relay keys, quota snapshots, usage accounting, and OpenAI/Anthropic-compatible proxy routes.

## Quick Start

```bash
npm install
npm run build
ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
npm start
```

Open `http://127.0.0.1:3000/admin`, initialize the admin account, add at least one upstream `user_...` key, then create a relay key.

## Environment

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `ENCRYPTION_KEY` | yes | empty | 32 random bytes encoded as base64url/base64; encrypts upstream keys. |
| `SESSION_SECRET` | recommended | empty | Stable deployment secret for admin sessions. |
| `RELAY_KEY_PEPPER` | no | derived | HMAC pepper for downstream relay key hashes. |
| `DATABASE_PATH` | no | `/app/data/cc-proxy.sqlite` | SQLite persistence path. |
| `PORT` | no | `3000` | HTTP port. |
| `HOST` | no | `0.0.0.0` | HTTP host. |
| `CC_API_BASE` | no | `https://api.commandcode.ai` | CommandCode API base URL. |

Generate a production encryption key:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Relay Usage

Clients use generated `sk-ccp_...` relay keys. Upstream `user_...` keys stay encrypted in SQLite and are selected server-side.

```bash
curl http://127.0.0.1:3050/v1/chat/completions \
  -H "Authorization: Bearer sk-ccp_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

## Docker

```bash
export ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
docker compose up -d
```

The admin UI is available at `http://127.0.0.1:3050/admin`. SQLite data is stored in the `cc-proxy-data` volume mounted at `/app/data`.

## Security Notes

- Upstream `user_...` keys are encrypted with AES-256-GCM.
- Relay keys are shown once at creation and stored only as HMAC-SHA256 hashes.
- Admin cookies are `HttpOnly` and `SameSite=Lax`.
- Recent diagnostics store status, model, endpoint, and token counts only. Prompts and response bodies are not stored.
