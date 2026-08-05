import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveRuntimeConfig } from "../src/runtime-config.js";

const requiredSecrets = {
  JWT_SECRET: "jwt-secret-with-at-least-thirty-two-characters",
  FIELD_ENCRYPTION_KEY: "field-secret-with-at-least-thirty-two-characters",
};

describe("runtime configuration", () => {
  it("fails fast when production WeChat credentials are absent", () => {
    assert.throws(
      () => resolveRuntimeConfig({
        ...requiredSecrets,
        DATABASE_URL: "postgresql://localhost/fengji",
      }),
      /WECHAT_APP_ID and WECHAT_APP_SECRET are required/,
    );
  });

  it("allows disabled WeChat login only in explicit demo mode", () => {
    const config = resolveRuntimeConfig({ ...requiredSecrets, DEMO_MODE: "true" });
    assert.equal(config.databaseUrl, null);
    assert.equal(config.wechatAppId, null);
    assert.equal(config.demoMode, true);
  });

  it("accepts complete production persistence and WeChat settings", () => {
    const config = resolveRuntimeConfig({
      ...requiredSecrets,
      DATABASE_URL: "postgresql://localhost/fengji",
      WECHAT_APP_ID: "wx-app-id",
      WECHAT_APP_SECRET: "wx-app-secret",
      DATABASE_POOL_SIZE: "12",
    });
    assert.equal(config.demoMode, false);
    assert.equal(config.databasePoolSize, 12);
    assert.equal(config.wechatAppId, "wx-app-id");
  });
});
