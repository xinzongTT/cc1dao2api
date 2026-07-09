# Command Code 版本头修复说明

## 问题现象

本地代理 `commandcode-proxy` 转发请求到上游 `https://api.commandcode.ai/alpha/generate` 时，上游返回 `upgrade_required`，提示当前客户端版本过旧，需要升级到最低版本要求以上。

该问题会导致通过本地代理调用 `/v1/chat/completions` 或 `/v1/messages` 时，请求无法正常完成。

## 根因分析

原始代理转发上游请求时只带了基础鉴权和环境头：

- `Authorization`
- `x-cli-environment`
- `x-project-slug`

真实 Command Code CLI 会携带 CLI 版本标识。通过解包 npm 包 `command-code@0.43.1` 可看到其共享常量中定义了：

- `CLI_VERSION: "x-command-code-version"`
- `CLI_ENVIRONMENT: "x-cli-environment"`

因此，上游会根据 `x-command-code-version` 判断客户端版本。如果代理没有带该头，或者版本低于上游最低要求，就会被判定为过旧 CLI 并返回 `upgrade_required`。

## 修复内容

新增统一请求头构造器：

- `server/commandCodeHeaders.mjs`

该文件集中维护默认 CLI 版本和默认 `User-Agent`：

- `DEFAULT_COMMAND_CODE_CLI_VERSION = "0.43.1"`
- `DEFAULT_COMMAND_CODE_CLI_USER_AGENT = "cli"`

配置层新增环境变量读取：

- `server/config/index.mjs`
- `CC_CLI_VERSION`
- `CC_CLI_USER_AGENT`

主生成接口转发已改为统一补头：

- `server/proxy/legacy.mjs`
- 请求路径：`/alpha/generate`
- 补充：`x-command-code-version`
- 补充：`User-Agent`

额度刷新接口已改为统一补头：

- `server/quota/provider.mjs`
- 请求路径：`/alpha/usage/summary`
- 请求路径：`/alpha/billing/credits`
- 请求路径：`/alpha/billing/subscriptions`
- 补充：`x-command-code-version`
- 补充：`User-Agent`

## 新增环境变量

默认情况下无需设置环境变量，代理会发送：

```bash
x-command-code-version: 0.43.1
User-Agent: cli
```

如果上游将来提高最低 CLI 版本门槛，只需要调整环境变量并重启代理：

```bash
CC_CLI_VERSION=0.44.0
CC_CLI_USER_AGENT=cli
```

Windows PowerShell 示例：

```powershell
$env:CC_CLI_VERSION = "0.44.0"
$env:CC_CLI_USER_AGENT = "cli"
npm start
```

Docker Compose 可在服务环境变量中加入：

```yaml
environment:
  CC_CLI_VERSION: "0.44.0"
  CC_CLI_USER_AGENT: "cli"
```

## 重启方式

本地开发进程需要重启后才会读取新的配置：

```powershell
npm start
```

如果正在使用指定端口，例如 `127.0.0.1:3050`，请停止旧进程后用相同环境变量重新启动。

Docker 部署可执行：

```bash
docker compose up -d --build
```

## 验证结果

已补充回归测试，覆盖以下行为：

- 配置默认 `cliVersion` 为 `0.43.1`
- 配置默认 `cliUserAgent` 为 `cli`
- `CC_CLI_VERSION` 可覆盖默认版本
- `CC_CLI_USER_AGENT` 可覆盖默认 UA
- `/alpha/generate` 上游请求包含 `x-command-code-version`
- `/alpha/generate` 上游请求包含 `User-Agent`
- 额度接口三条上游请求均包含 `x-command-code-version`
- 额度接口三条上游请求均包含 `User-Agent`

验证命令：

```bash
npm test
npm run build
npm audit --audit-level=high
```

最近一次验证结果：

| 项目 | 结果 |
| --- | --- |
| `npm test` | 16 个测试文件通过，64 个测试通过 |
| `npm run build` | Vite 生产构建通过 |
| `npm audit --audit-level=high` | 0 个高危漏洞 |
| `npm view command-code version --json` | 当前版本为 `0.43.1` |

## 后续维护

如果再次出现 `upgrade_required`：

1. 查询最新 CLI 版本：`npm view command-code version --json`
2. 将 `CC_CLI_VERSION` 设置为最新版本号
3. 重启代理
4. 重新调用本地代理接口验证

正常情况下无需改代码。
