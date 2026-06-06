# commandcode 代理项目 — AGENTS.md

## 一句话

Command Code API → OpenAI 兼容接口的反代代理。接收 OpenAI 格式的 `/v1/chat/completions`，翻译成 CC 内部协议发往 `api.commandcode.ai`，再把 NDJSON 响应转成 SSE 流回。

## 环境前提

- Node >= 18.0.0
- **零外部依赖**，无需 `npm install`，纯 Node.js 内置模块
- ESM 模块（`package.json` 中 `"type": "module"`，文件扩展名 `.mjs`）
  - ❌ 不要用 `require()`，不要创建 `.js` / `.cjs` 文件

## 启动

```bash
npm start            # 启动（node proxy.mjs）
npm run dev          # watch 模式（node --watch proxy.mjs，Node 内置，非 nodemon）
```

配置加载优先级：**环境变量 > config.json > 默认值**。

| 环境变量 | config.json 字段 | 默认值 |
|----------|-----------------|--------|
| `CC_API_KEY` | `apiKey` | `""` |
| `PORT` | `port` | `3000` |
| `HOST` | `host` | `0.0.0.0` |
| `CC_API_BASE` | `apiBase` | `https://api.commandcode.ai` |
| `PROJECT_SLUG` | `projectSlug` | `cc-proxy` |
| `LOG_FILE` | `logFile` | `""` |

当前实际端口：`3050`（config.json 覆写），监听 `0.0.0.0`（所有网络接口，非仅 localhost）。

## 快速验证

```bash
# 健康检查
curl http://127.0.0.1:3050/health

# 模型列表
curl http://127.0.0.1:3050/v1/models

# 非流式调用
curl http://127.0.0.1:3050/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"deepseek/deepseek-v4-flash","messages":[{"role":"user","content":"hi"}]}'
```

## 架构

```
工具 (OpenAI格式) → proxy.mjs (端口3050) → api.commandcode.ai/alpha/generate
```

CC API 端点是 `/alpha/generate`，**不是** `/v1/chat/completions`——不要弄混。

单文件 `proxy.mjs`（1335 行），包含 HTTP 服务器、协议转换、session 管理、streaming 全部逻辑。

## 关键文件

| 文件 | 作用 |
|------|------|
| `proxy.mjs` | 全部逻辑：HTTP 服务器、协议转换、session 管理、streaming |
| `config.json` | 端口、API Key、日志路径等 |
| `README.md` | 完整文档（模型列表、接入示例） |
| `.commandcode/taste/` | CLI 自动生成的 taste 数据，**不要手动修改** |

## 已实现的协议

- **输入**: OpenAI Chat Completions (`/v1/chat/completions`) + Anthropic Messages (`/v1/messages`)
- **输出**: OpenAI SSE 流式 + 非流式 JSON；Anthropic SSE 流式 + 非流式 JSON
- **多模态**: 支持 `image_url` 格式图片输入（需用 vision 模型如 `xiaomi/mimo-v2.5`）
- **工具调用**: tool_calls 完整双向映射，含 tool_choice/parallel_tool_calls 透传
- **模型列表**: 从 CC Provider API 动态拉取（5min 缓存），硬编码兜底
- **推理强度**: `reasoning_effort` (low/medium/high/max)
- **Session**: 2h 到期 + 30min 抖动，进程级管理
- **流式超时**: 流式 30s，非流式 90s 无新数据自动中断

## 反检测要点

基于真实 CLI 抓包逆向，关键伪装：

- 请求体用 `config/memory/taste/permissionMode/params/threadId` 信封格式
- 字段名 camelCase (`workingDir` 不是 `working_dir`)
- `x-session-id`: 每个进程一个，2h 循环
- `x-command-code-version`: `0.32.3`（手动更新）
- `x-cli-environment`: `production`
- `traceparent`: W3C Trace Context
- API Key 哈希映射：客户端填 `sk-xxx` 等占位 Key 会自动替换为 config 里的真实 Key

## 常见陷阱

- 本地 `curl.exe` 用 `-d @file.json` 传 body（PowerShell 的 `curl` 是 `Invoke-WebRequest` 别名）
- 工具连代理时填的 API Key 会被透传给 CC 做认证，不要填假的
- CC API Key 格式是 `user_xxx`，长度远长于 OpenAI 的 `sk-xxx`
- 如果 401，检查 Key 是否在 config.json 中正确配置，以及 CC 账号是否有效
- CC 的 `stream` 参数强制为 `true`，非流式请求在代理层做 buffer
