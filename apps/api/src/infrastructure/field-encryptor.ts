import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export class FieldEncryptor {
  private readonly key: Buffer;

  constructor(secret: string) {
    if (secret.length < 32) throw new Error("FIELD_ENCRYPTION_KEY must contain at least 32 characters");
    this.key = createHash("sha256").update(secret, "utf8").digest();
  }

  encrypt(value: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `v1.${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
  }

  decrypt(payload: string): string {
    const [version, iv, tag, encrypted] = payload.split(".");
    if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Invalid encrypted field");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }
}
