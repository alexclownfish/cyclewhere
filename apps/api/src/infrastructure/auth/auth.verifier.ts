import { jwtVerify } from "jose";
import { DomainError } from "../../domain/errors.js";

export class AuthVerifier {
  private readonly secret: Uint8Array;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    this.secret = new TextEncoder().encode(secret);
  }

  async verify(authorization: string | undefined): Promise<{ id: string }> {
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    if (!match?.[1]) throw new DomainError("UNAUTHORIZED", "缺少有效的 Bearer token", 401);
    try {
      const { payload } = await jwtVerify(match[1], this.secret, {
        algorithms: ["HS256"],
        issuer: "fengji-api",
        audience: "fengji-miniprogram",
      });
      if (!payload.sub || payload.sub.length > 100) throw new Error("invalid subject");
      return { id: payload.sub };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("UNAUTHORIZED", "登录凭证无效或已过期", 401);
    }
  }
}
