# CommandCode Proxy

单服务 CommandCode 中转站，包含管理后台、加密上游 key 池、下游 relay key、额度快照、用量统计，以及 OpenAI/Anthropic 兼容代理接口。

## 快速启动

```bash
npm install
npm run build
ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")" \
npm start
```

打开 `http://127.0.0.1:3000/admin`，初始化管理员账号，添加至少一个上游 `user_...` key，然后创建下游 relay key。

## 环境变量

| 变量 | 必填 | 默认值 | 说明 |
| --- | --- | --- | --- |
| `ENCRYPTION_KEY` | 是 | 空 | 32 字节随机值，使用 base64url/base64 编码，用于加密上游 key。 |
| `SESSION_SECRET` | 建议 | 空 | 管理员会话使用的稳定部署密钥。 |
| `RELAY_KEY_PEPPER` | 否 | 从 `ENCRYPTION_KEY` 派生 | 下游 relay key HMAC pepper。 |
| `DATABASE_PATH` | 否 | `/app/data/cc-proxy.sqlite` | SQLite 持久化路径。 |
| `PORT` | 否 | `3000` | HTTP 端口。 |
| `HOST` | 否 | `0.0.0.0` | HTTP 监听地址。 |
| `CC_API_BASE` | 否 | `https://api.commandcode.ai` | CommandCode API 地址。 |

生成生产环境加密 key：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

## Relay 调用

客户端使用管理后台生成的 `sk-ccp_...` relay key。上游 `user_...` key 加密保存在 SQLite 中，由服务端自动选择。

```bash
curl http://127.0.0.1:3050/v1/chat/completions \
  -H "Authorization: Bearer sk-ccp_xxxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","max_tokens":100,"messages":[{"role":"user","content":"hi"}]}'
```

## Docker 部署

```bash
export ENCRYPTION_KEY="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
export SESSION_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))")"
docker compose up -d
```

管理后台地址：`http://127.0.0.1:3050/admin`。SQLite 数据存放在 `cc-proxy-data` volume，对应容器内 `/app/data`。

## 安全说明

- 上游 `user_...` key 使用 AES-256-GCM 加密保存。
- 下游 relay key 仅创建时显示一次，数据库只保存 HMAC-SHA256 哈希。
- 管理员 cookie 使用 `HttpOnly` 和 `SameSite=Lax`。
- 最近请求诊断只记录状态、模型、端点和 token 数，不保存 prompt、请求正文或响应正文。
