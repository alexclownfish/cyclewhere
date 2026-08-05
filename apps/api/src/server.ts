import { buildApp } from "./app.js";
import { Pool } from "pg";
import { InMemoryRepository } from "./infrastructure/in-memory-repository.js";
import { PostgresRepository } from "./infrastructure/postgres-repository.js";
import { demoEvents, demoRoadbooks } from "./infrastructure/seed.js";
import { WeChatHttpSessionGateway } from "./infrastructure/auth/wechat-session.gateway.js";
import { resolveRuntimeConfig } from "./runtime-config.js";

const config = resolveRuntimeConfig(process.env);
const pool = config.databaseUrl
  ? new Pool({ connectionString: config.databaseUrl, max: config.databasePoolSize })
  : null;
const repository = pool
  ? new PostgresRepository(pool)
  : new InMemoryRepository({ events: demoEvents, roadbooks: demoRoadbooks });
const wechatGateway = config.wechatAppId && config.wechatAppSecret
  ? new WeChatHttpSessionGateway(config.wechatAppId, config.wechatAppSecret)
  : undefined;
const app = await buildApp({
  repository,
  authSecret: config.authSecret,
  fieldEncryptionKey: config.fieldEncryptionKey,
  logger: true,
  ...(wechatGateway ? { wechatGateway } : {}),
});
await app.listen(config.port, config.host);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    await app.close();
    await pool?.end();
    process.exit(0);
  });
}
