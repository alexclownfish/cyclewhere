# 本地开发

## 环境

- Node.js 24+
- npm 11+
- 微信开发者工具
- Docker Desktop（接入 PostgreSQL/PostGIS 和 Redis 时使用）

## 安装与验证

```powershell
npm run setup
npm run verify
```

启动 API：

```powershell
npm run dev:api
```

小程序使用微信开发者工具导入 `apps/mini-program`。本地联调前，将开发者工具设置为允许本地调试，并在 `apps/mini-program/config/env.ts` 切换 API 地址。

## 数据服务

```powershell
docker compose up -d postgres redis
```

复制 `.env.example` 为本地 `.env` 后填写微信、地图和对象存储配置。禁止提交真实密钥。

## 提交前门禁

```powershell
npm run verify
```

除自动化测试外，涉及授权、地图、分享、订阅消息和安全区的改动必须在 iOS 与 Android 微信真机复验。
