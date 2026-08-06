# 腾讯云单机部署指南

本文用于把当前项目部署到一台腾讯云 Linux 服务器，目标是先完成可用的微信小程序 MVP 上线链路：

```text
微信小程序 -> HTTPS 域名 -> Caddy -> NestJS API -> PostgreSQL/PostGIS
                                             -> Redis（后续共享限流，可选）
```

这是一台服务器的过渡方案，适合内测和早期运营，不具备多可用区和自动故障切换能力。用户量稳定后，优先把 PostgreSQL/PostGIS 和 Redis 迁移到腾讯云托管服务，再把 API 扩展为两台服务器。

## 1. 上线前准备

服务器建议：

- Ubuntu 22.04/24.04 LTS 或 CentOS Stream 9（截图中的 CentOS 服务器也可以使用本文流程）。
- 最低 `2 核 4 GB`，建议系统盘 40 GB、数据盘 100 GB 以上。
- 服务器地域、域名备案主体和微信小程序主体保持一致。
- 腾讯云安全组只开放 `22`、`80`、`443`，不要开放 `3000`、`5432`、`6379`。

准备一个已备案域名，例如 `cyclewhere.cn`，并添加：

```text
api.cyclewhere.cn -> 腾讯云服务器公网 IP
```

正式小程序必须在微信公众平台配置 `https://api.cyclewhere.cn` 为 `request` 合法域名。不要使用 IP、HTTP 或自签名证书。

## 2. 安装 Docker 和 Git

### Ubuntu

```bash
sudo apt update
sudo apt install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"
newgrp docker
docker --version
docker compose version
```

### CentOS / RHEL

截图中的服务器是 CentOS。请以 `root` 或具有 sudo 权限的用户执行：

```bash
if command -v dnf >/dev/null 2>&1; then
  dnf install -y ca-certificates curl git
else
  yum install -y ca-certificates curl git
fi
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker
docker --version
docker compose version
```

如果 CentOS 7 安装脚本提示系统版本不再受支持，建议把腾讯云系统重装为 Ubuntu 22.04 LTS 或 CentOS Stream 9，再继续部署。

如果服务器开启了腾讯云防火墙，还要在控制台同步放行 `80/443`。

## 3. 拉取代码

```bash
sudo mkdir -p /opt/fengji
sudo chown -R "$USER":"$USER" /opt/fengji
git clone https://github.com/alexclownfish/cyclewhere.git /opt/fengji
cd /opt/fengji
```

如果你已经在 `/opt/fengji` 中并且之前切到了旧提交，先回到最新 `main`：

```bash
cd /opt/fengji
git fetch origin
git switch main
git pull --ff-only origin main
git log -1 --oneline
```

输出应为 `cbd17e6 docs: add Tencent Cloud deployment runbook` 或更新的提交。不要使用早期的 `79a6fd8`，那个提交还没有 `deploy/` 目录。

正式部署仍建议使用已验收的 tag 或固定提交；确认版本后可执行 `git checkout <commit>`，但必须确认该提交包含 `deploy/docker-compose.prod.yml`。

## 4. 创建生产密钥

```bash
cd /opt/fengji
cp deploy/env.production.example deploy/.env.production
chmod 600 deploy/.env.production
openssl rand -hex 32
```

编辑 `deploy/.env.production`，替换 `POSTGRES_PASSWORD`、`REDIS_PASSWORD`、`JWT_SECRET`、`FIELD_ENCRYPTION_KEY`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`。

`FIELD_ENCRYPTION_KEY` 一旦用于保存真实手机号和紧急联系人，后续不能随意更换，否则旧数据无法解密。密钥不要提交 Git 或写入 Dockerfile。

## 5. 配置 HTTPS 域名

编辑 `deploy/Caddyfile`：

```caddyfile
api.cyclewhere.cn {
  encode gzip
  reverse_proxy api:3000
}
```

Caddy 会在 DNS 已生效、服务器 `80/443` 可访问后自动申请和续期证书。

## 6. 启动服务

```bash
cd /opt/fengji
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml config

docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml up -d --build
```

API 容器启动时会先执行 `npm run migrate:prod`。迁移由数据库中的 `schema_migrations` 表保证幂等，完成后才启动 API。

当前后端尚未使用 Redis，共享限流仍属于生产增强项，因此 Redis 被放在 Compose 的 `cache` profile 中，默认不会启动，也不会阻断 API。以后接入 Redis 后可增加 `--profile cache` 启动。

查看状态和日志：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml ps

docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml logs -f api
```

验证健康检查：

```bash
curl -i https://api.cyclewhere.cn/health
```

预期响应：`{"status":"ok"}`。

## 7. 配置小程序真实 API

修改 `apps/mini-program/config/env.ts`：

```ts
export const API_BASE_URL = 'https://api.cyclewhere.cn';
export const USE_MOCK = false;
```

重新用微信开发者工具编译、预览和上传。必须确认微信公众平台已配置 API 域名为 `request` 合法域名，且 `WECHAT_APP_ID` 与小程序 AppID 一致。

## 8. 日常更新

先在本地执行：

```powershell
npm run verify
```

服务器更新：

```bash
cd /opt/fengji
git fetch origin
git checkout <new-commit>
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml up -d --build
```

更新过程中迁移会自动执行。若 API 日志显示迁移失败，先检查数据库连接和迁移错误，不要反复重启。

## 9. 数据备份和恢复

创建备份目录并导出数据库：

```bash
sudo mkdir -p /opt/backups/fengji
sudo chown -R "$USER":"$USER" /opt/backups/fengji
cd /opt/fengji
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml exec -T postgres \
  pg_dump -U fengji -d fengji --format=custom \
  > "/opt/backups/fengji/fengji-$(date +%F-%H%M).dump"
```

备份必须复制到服务器之外的对象存储或另一台机器。恢复前先停止 API，避免业务写入：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml stop api

docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml exec -T postgres \
  pg_restore -U fengji -d fengji --clean --if-exists \
  < /opt/backups/fengji/<backup-file>.dump
```

生产数据存在后不要使用 `DROP TABLE` 做回滚，只能通过新的向前迁移修复数据结构。

## 10. 常见故障

### `502 Bad Gateway`

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml logs api
```

通常是 API 未启动、环境变量缺失、迁移失败或容器内部端口不是 `3000`。

### Caddy 无法申请证书

确认 DNS 已指向当前公网 IP，腾讯云安全组和系统防火墙开放 `80/443`，并检查：

```bash
docker compose --env-file deploy/.env.production \
  -f deploy/docker-compose.prod.yml logs caddy
```

### API 报微信凭据缺失

生产环境不能设置 `DEMO_MODE=true`，并检查 `deploy/.env.production` 是否被 Compose 读取。不要把完整配置输出粘贴到公开渠道。

## 11. 上线放行清单

- [ ] 腾讯云安全组仅开放 `22/80/443`。
- [ ] 域名备案完成，DNS 已指向服务器。
- [ ] `https://api.<domain>/health` 返回 `200`。
- [ ] PostgreSQL/PostGIS 迁移全部成功。
- [ ] 微信公众平台已配置合法域名和隐私协议。
- [ ] 微信登录、活动列表、路书、报名、取消报名完成真机验证。
- [ ] 已执行一次数据库备份并验证备份文件可读。
- [ ] 已保留上一版本提交号，具备回滚路径。

当前项目仍有生产边界：本单机方案没有高可用，登录限流还不是共享 Redis 实现，活动编辑/取消通知、GPX 导入和运营后台也不在当前核心切片内。上线前请同步参考 [QA 报告](../tests/qa-review-report.md)。
