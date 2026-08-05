import { SignJWT } from "jose";

export class AuthIssuer {
  private readonly secret: Uint8Array;
  readonly expiresIn = 7 * 24 * 60 * 60;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("JWT_SECRET must contain at least 32 characters");
    this.secret = new TextEncoder().encode(secret);
  }

  issue(userId: string): Promise<string> {
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("fengji-api")
      .setAudience("fengji-miniprogram")
      .setIssuedAt()
      .setExpirationTime(`${this.expiresIn}s`)
      .sign(this.secret);
  }
}
