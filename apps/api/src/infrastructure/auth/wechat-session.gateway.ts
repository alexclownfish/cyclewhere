import { createHash } from "node:crypto";
import { DomainError } from "../../domain/errors.js";

export interface WeChatSession {
  openId: string;
  unionId?: string;
}

export interface WeChatSessionGateway {
  exchange(code: string): Promise<WeChatSession>;
}

export function stableUserId(openId: string): string {
  const bytes = createHash("sha256").update(`fengji:${openId}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export class WeChatHttpSessionGateway implements WeChatSessionGateway {
  constructor(
    private readonly appId: string,
    private readonly appSecret: string,
  ) {
    if (!appId || !appSecret) throw new Error("WECHAT_APP_ID and WECHAT_APP_SECRET are required");
  }

  async exchange(code: string): Promise<WeChatSession> {
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set("appid", this.appId);
    url.searchParams.set("secret", this.appSecret);
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");
    let response: Response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    } catch {
      throw new DomainError("WECHAT_UNAVAILABLE", "微信登录服务暂不可用", 503);
    }
    if (!response.ok) throw new DomainError("WECHAT_UNAVAILABLE", "微信登录服务暂不可用", 503);
    const payload = (await response.json()) as {
      openid?: string;
      unionid?: string;
      errcode?: number;
    };
    if (payload.errcode || !payload.openid) {
      throw new DomainError("INVALID_WECHAT_CODE", "微信登录凭证无效或已过期", 401);
    }
    return {
      openId: payload.openid,
      ...(payload.unionid ? { unionId: payload.unionid } : {}),
    };
  }
}

export class DisabledWeChatSessionGateway implements WeChatSessionGateway {
  async exchange(): Promise<WeChatSession> {
    throw new DomainError("WECHAT_LOGIN_DISABLED", "当前环境未配置微信登录", 503);
  }
}
