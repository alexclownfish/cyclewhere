export interface RuntimeConfig {
  authSecret: string;
  fieldEncryptionKey: string;
  demoMode: boolean;
  databaseUrl: string | null;
  databasePoolSize: number;
  wechatAppId: string | null;
  wechatAppSecret: string | null; // security-scan: allow - server-only runtime configuration
  port: number;
  host: string;
}

export function resolveRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const authSecret = env.JWT_SECRET;
  if (!authSecret || authSecret.length < 32) {
    throw new Error("JWT_SECRET must contain at least 32 characters");
  }
  const fieldEncryptionKey = env.FIELD_ENCRYPTION_KEY;
  if (!fieldEncryptionKey || fieldEncryptionKey.length < 32) {
    throw new Error("FIELD_ENCRYPTION_KEY must contain at least 32 characters");
  }

  const demoMode = env.DEMO_MODE === "true";
  const databaseUrl = env.DATABASE_URL || null;
  if (!demoMode && !databaseUrl) {
    throw new Error("DATABASE_URL is required unless DEMO_MODE=true");
  }

  const wechatAppId = env.WECHAT_APP_ID || null;
  const wechatAppSecret = env.WECHAT_APP_SECRET || null; // security-scan: allow - injected server secret
  if (!demoMode && (!wechatAppId || !wechatAppSecret)) {
    throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required unless DEMO_MODE=true");
  }
  if ((wechatAppId && !wechatAppSecret) || (!wechatAppId && wechatAppSecret)) {
    throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET must be configured together");
  }

  const databasePoolSize = Number.parseInt(env.DATABASE_POOL_SIZE ?? "10", 10);
  if (!Number.isInteger(databasePoolSize) || databasePoolSize < 1) {
    throw new Error("DATABASE_POOL_SIZE must be a positive integer");
  }
  const port = Number.parseInt(env.PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return {
    authSecret,
    fieldEncryptionKey,
    demoMode,
    databaseUrl,
    databasePoolSize,
    wechatAppId,
    wechatAppSecret,
    port,
    host: env.HOST || "0.0.0.0",
  };
}
