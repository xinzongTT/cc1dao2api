# CommandCode Proxy 部署说明

本文记录 `cc1dao2api` 在生产服务器上的推荐部署方式。

## 部署源

- GitHub 仓库: `https://github.com/xinzongTT/cc1dao2api.git`
- 部署分支: `main`
- 运行方式: `Node.js + systemd`
- 监听地址: `0.0.0.0:3050`

## 必要环境变量

至少需要准备以下变量:

```bash
ENCRYPTION_KEY=<32字节原始值，base64url 或 base64 编码>
SESSION_SECRET=<随机字符串>
DATABASE_PATH=/var/lib/commandcode-proxy/cc-proxy.sqlite
PORT=3050
HOST=0.0.0.0
CC_API_BASE=https://api.commandcode.ai
CC_CLI_VERSION=0.43.1
CC_CLI_USER_AGENT=cli
```

可选但建议设置:

```bash
RELAY_KEY_PEPPER=<可选，未设置则由 ENCRYPTION_KEY 派生>
PROJECT_SLUG=cc-proxy
LOG_FILE=
LOG_LEVEL=info
CC_USE_PROVIDER_MODELS=true
```

## 推荐安装步骤

```bash
git clone https://github.com/xinzongTT/cc1dao2api.git /opt/commandcode-proxy
cd /opt/commandcode-proxy
npm ci
npm run build
```

创建数据目录与环境文件:

```bash
install -d -m 750 /var/lib/commandcode-proxy
```

将环境变量写入 `/etc/commandcode-proxy.env`，然后创建 systemd 服务。

## systemd 示例

```ini
[Unit]
Description=CommandCode Proxy
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/commandcode-proxy
EnvironmentFile=/etc/commandcode-proxy.env
ExecStart=/usr/bin/node server/index.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

启用并启动:

```bash
systemctl daemon-reload
systemctl enable --now commandcode-proxy
```

## 验证

```bash
curl http://127.0.0.1:3050/health
```

管理后台地址:

```text
http://<server-ip>:3050/admin
```

如果再次遇到 `upgrade_required`，优先检查:

1. `CC_CLI_VERSION` 是否低于上游要求
2. `CC_CLI_USER_AGENT` 是否仍为 `cli`
3. 服务是否已重启并加载新环境变量
