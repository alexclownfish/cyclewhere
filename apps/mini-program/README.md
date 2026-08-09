# 骑哪儿微信小程序 MVP

原生微信小程序 + TypeScript 实现，覆盖活动发现、详情、报名、取消报名、路书、结构化发布和我的活动。默认使用本地演示数据，不依赖后端即可走通完整流程。

## 在微信开发者工具中运行

1. 安装依赖：`npm install`
2. 运行 `npm run build:wechat`，生成微信开发者工具需要的 JavaScript 页面文件。
3. 微信开发者工具选择“导入项目”，目录指向本目录；修改 TypeScript 后再次运行该命令。
4. 首次演示可使用配置中的 `touristappid`；真机能力和发布前请替换成正式 AppID。
5. 开发者工具需启用 TypeScript 编译插件（`project.config.json` 已配置）。

演示数据存储在小程序本地缓存中，报名、取消和发布会跨页面同步。需要恢复初始状态时，在开发者工具的 Storage 面板删除 `ride_demo_events_v1` 和 `ride_demo_registrations_v1`。

## 后端联调

编辑 `config/env.ts`，将 `API_BASE_URL` 设置为 API 地址。非空时客户端自动切换到真实 API：优先复用本地 `auth_token`；没有 token 时调用 `wx.login`，再通过 `POST /api/v1/auth/wechat/login` 换取 JWT。所有受保护请求只发送 `Authorization: Bearer <token>`，不发送或信任客户端用户 ID。

本地 API 的 Demo mode 未配置微信凭据时，可使用与服务端相同的 `JWT_SECRET` 运行 `npm run token:demo -- user-demo`，然后在微信开发者工具 Storage 中将输出写入 `auth_token`。模拟器连接 `http://localhost:3000` 时需关闭“校验合法域名”；真机和发布环境必须配置 HTTPS 合法域名。

生产登录要求后端 `WECHAT_APP_ID` 与 `project.config.json` 中的 AppID 完全一致，并在微信公众平台把 `https://cyclewhereapi.alexcld.com` 加入 request 合法域名。发布页会在进入时检查登录；JWT 过期会自动重新执行一次 `wx.login` 并重试原请求，仍失败时页面会展示微信或 API 返回的具体原因。

主要契约：

- `GET /api/v1/events`、`GET /api/v1/events/:id`
- `POST /api/v1/events` 创建草稿，成功后调用 `POST /api/v1/events/:id/publish`
- `POST /api/v1/events/:id/registrations`，带 `Idempotency-Key`
- `DELETE /api/v1/events/:id/registrations/me`
- `GET /api/v1/events/:id/registration-status`
- `GET /api/v1/me/registrations` 返回当前用户完整的有效、取消及历史报名
- `GET /api/v1/routes`、`GET /api/v1/routes/:id`

响应统一为 `{ data: T, requestId?: string }`。后端列表的 `{ items, nextCursor }`、事件/路书 DTO 与 UI 模型由 `services/api-contract.ts` 显式转换。后端路书的 `track`、`elevationProfile`、`maxGradient` 均直接映射，WGS84 轨迹和 POI 只在进入微信地图前转换为 GCJ-02。报名联系方式会发往 API 并由服务端字段加密器加密，客户端不持久化明文。

## 质量检查

```bash
npm run typecheck
npm test
```

单元测试覆盖名额与截止时间、报名表单、发布安全要求、重复报名幂等、取消释放名额、完整历史报名聚合、JWT 获取与复用、真实路书字段映射、报名请求契约、两阶段发布和 WGS84→GCJ-02 转换。正式上线前仍需在微信开发者工具完成基础库兼容、真机地图、正式微信凭据、合法域名、隐私协议和订阅消息验收。
