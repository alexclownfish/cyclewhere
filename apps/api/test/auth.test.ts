import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jwtVerify } from "jose";
import { buildApp } from "../src/app.js";
import { DomainError } from "../src/domain/errors.js";
import { InMemoryRepository } from "../src/infrastructure/in-memory-repository.js";
import { stableUserId, type WeChatSessionGateway } from "../src/infrastructure/auth/wechat-session.gateway.js";
import { eventFixture, fixedNow, roadbookFixture, testAuthSecret } from "./helpers.js";

class FakeWeChatGateway implements WeChatSessionGateway {
  constructor(private readonly fail = false) {}

  async exchange(code: string) {
    if (this.fail) throw new DomainError("INVALID_WECHAT_CODE", "微信登录凭证无效或已过期", 401);
    return { openId: `openid-${code}` };
  }
}

describe("WeChat authentication", () => {
  it("exchanges a code, signs a constrained token and authorizes protected APIs", async () => {
    const repository = new InMemoryRepository({ roadbooks: [roadbookFixture()] });
    const app = await buildApp({
      repository,
      clock: () => fixedNow,
      authSecret: testAuthSecret,
      wechatGateway: new FakeWeChatGateway(),
    });
    const login = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      payload: { code: "valid-login-code" },
    });
    assert.equal(login.statusCode, 201);
    const body = login.json().data as { accessToken: string; expiresIn: number; user: { id: string } };
    const { payload } = await jwtVerify(body.accessToken, new TextEncoder().encode(testAuthSecret), {
      algorithms: ["HS256"],
      issuer: "fengji-api",
      audience: "fengji-miniprogram",
    });
    assert.equal(payload.sub, stableUserId("openid-valid-login-code"));
    assert.equal(body.user.id, payload.sub);
    assert.equal(body.expiresIn, 604800);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/events",
      headers: { authorization: `Bearer ${body.accessToken}` },
      payload: {
        ...eventFixture(),
        id: undefined,
        organizerId: undefined,
        registrationCount: undefined,
        status: undefined,
        createdAt: undefined,
        updatedAt: undefined,
        version: undefined,
      },
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.json().data.organizerId, body.user.id);
    await app.close();
  });

  it("rejects invalid WeChat codes without issuing a token", async () => {
    const app = await buildApp({
      repository: new InMemoryRepository(),
      authSecret: testAuthSecret,
      wechatGateway: new FakeWeChatGateway(true),
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/wechat/login",
      payload: { code: "expired-code" },
    });
    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error.code, "INVALID_WECHAT_CODE");
    await app.close();
  });

  it("keeps derived user identifiers stable and non-reversible", () => {
    const first = stableUserId("sensitive-openid");
    assert.equal(first, stableUserId("sensitive-openid"));
    assert.notEqual(first, stableUserId("other-openid"));
    assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.ok(!first.includes("sensitive"));
  });
});
