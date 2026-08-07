# CycleWhere Go API

生产后端使用 Go 1.25、Gin 和 pgx，保持原 Node API 的 URL、状态码、JSON envelope、JWT、OpenID 用户 ID 算法和 PostgreSQL schema 兼容。

## 本地验证

```bash
go test -count=1 ./...
go vet ./...
go build ./...
```

设置 `DATABASE_URL` 后会运行真实 PostgreSQL 并发测试；未设置时该用例明确跳过。

```bash
DATABASE_URL='postgresql://...' go test -count=1 ./internal/store
```

## 启动

必需环境变量：`DATABASE_URL`、`JWT_SECRET`、`FIELD_ENCRYPTION_KEY`、`WECHAT_APP_ID`、`WECHAT_APP_SECRET`。头像目录由 `AVATAR_UPLOAD_DIR` 指定，默认 `/tmp/fengji-avatars`。

```bash
go run ./cmd/migrate
go run ./cmd/server
```

生产 Compose 会先运行迁移器，再以 UID/GID `10001` 启动 API。首次复用旧头像卷时按部署文档执行一次权限迁移。

## 生产验收

`scripts/go-canary-smoke.sh` 验证公开契约、登录错误映射、资料、头像、GPX、创建、发布、编辑、报名、幂等重放、我的活动和取消，并自动清理测试记录。
