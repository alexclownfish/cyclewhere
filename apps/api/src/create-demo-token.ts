import { SignJWT } from "jose";

const secret = process.env.JWT_SECRET;
if (!secret || secret.length < 32) {
  throw new Error("JWT_SECRET must contain at least 32 characters");
}
const userId = process.argv[2]?.trim() || "rider-demo";
const token = await new SignJWT({})
  .setProtectedHeader({ alg: "HS256" })
  .setSubject(userId)
  .setIssuer("fengji-api")
  .setAudience("fengji-miniprogram")
  .setIssuedAt()
  .setExpirationTime("1h")
  .sign(new TextEncoder().encode(secret));

process.stdout.write(`${token}\n`);
