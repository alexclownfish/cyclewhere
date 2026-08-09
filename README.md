# 骑哪儿：公路骑行活动小程序

面向公路骑行组织者和骑友的核心 MVP，覆盖活动发现、创建与发布、报名与取消、路书展示以及我的活动。项目包含可运行的微信原生小程序、Go/Gin API、PostgreSQL/PostGIS 数据层和高保真 Web 演示。

## 工程目录

- `apps/mini-program`：原生微信小程序 + TypeScript，支持 Mock 演示和真实 API 两种模式。
- `apps/api-go`：生产 Go 1.25 + Gin API，包含 JWT/微信登录、资料头像、活动、路书、GPX 和报名模块。
- `apps/api`：保留的 Node/NestJS 兼容实现和数据库迁移源文件，用于回滚与契约对照。
- `apps/api/migrations`：PostgreSQL/PostGIS 初始化迁移与迁移运行器。
- `index.html`：无需构建的交互演示，桌面端提供评审导航，移动端呈现小程序视图。
- `docs`：产品架构、Agent 协作规范、质量门禁和架构决策记录。
- `tests`：发布验收清单、QA 报告和质量资产测试。

## 快速开始

环境要求为 Node.js 24+、npm 11+。安装并执行统一质量门禁：

```powershell
npm run setup
npm run verify
```

Go API 本地运行（需要 PostgreSQL/PostGIS）：

```powershell
$env:JWT_SECRET="replace-with-a-local-secret-of-at-least-32-characters"
$env:FIELD_ENCRYPTION_KEY="use-a-different-local-secret-of-at-least-32-characters"
$env:DATABASE_URL="postgresql://127.0.0.1:5432/fengji"
$env:WECHAT_APP_ID="正式小程序 AppID"
$env:WECHAT_APP_SECRET="正式小程序 AppSecret"
go run ./apps/api-go/cmd/server
```

微信开发者工具导入 `apps/mini-program`。默认空 `API_BASE_URL` 使用本地 Mock；联调方式、JWT 获取和合法域名要求见 `apps/mini-program/README.md`。生产风格数据库配置与迁移步骤见 `apps/api/README.md`。

## 已实现边界

- Bearer JWT 身份校验；客户端自报用户 ID 不参与授权。
- 报名幂等、并发名额控制、截止时间和取消释放名额。
- 手机号和紧急联系人使用 AES-256-GCM 字段加密。
- WGS84 路书持久化，微信地图展示前转换为 GCJ-02。
- 装备、近期距离/爬升、车型、骑行纪律和风险说明的结构化发布与确认。

当前生产后端使用 Go/Gin。内容审核、运营后台、共享限流和 iOS/Android 微信真机验收仍属于后续上线门禁。

## 设计与验收

- `docs/product-architecture.md`：产品范围、业务规则、系统架构和数据模型。
- `docs/agent-collaboration.md`：Agent 职责、互审机制和交付规则。
- `docs/quality-and-agent-workflow.md`：测试矩阵、安全检查和发布门禁。
- `docs/deployment-tencent-cloud.md`：腾讯云单机 Docker、HTTPS、微信合法域名、备份和回滚部署手册。
- `tests/mvp-acceptance-checklist.md`：上线前验收证据清单。
- `assets/ATTRIBUTION.md`：演示摄影素材来源。
