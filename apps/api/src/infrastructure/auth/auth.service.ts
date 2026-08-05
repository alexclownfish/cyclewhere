import { Inject, Injectable } from "@nestjs/common";
import { AuthIssuer } from "./auth.issuer.js";
import { stableUserId, type WeChatSessionGateway } from "./wechat-session.gateway.js";

export const WECHAT_SESSION_GATEWAY = Symbol("WECHAT_SESSION_GATEWAY");

@Injectable()
export class AuthService {
  constructor(
    @Inject(WECHAT_SESSION_GATEWAY) private readonly gateway: WeChatSessionGateway,
    @Inject(AuthIssuer) private readonly issuer: AuthIssuer,
  ) {}

  async login(code: string) {
    const session = await this.gateway.exchange(code);
    const userId = stableUserId(session.openId);
    return {
      accessToken: await this.issuer.issue(userId),
      tokenType: "Bearer" as const,
      expiresIn: this.issuer.expiresIn,
      user: { id: userId },
    };
  }
}
