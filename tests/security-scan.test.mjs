import assert from "node:assert/strict";
import test from "node:test";

import { scanText } from "../scripts/security-scan.mjs";

test("detects a committed private key", () => {
  const findings = scanText("-----BEGIN PRIVATE KEY-----\nexample"); // security-scan: allow
  assert.equal(findings.some((finding) => finding.id === "private-key"), true);
});

test("detects secrets embedded in URLs", () => {
  const findings = scanText('const url = "postgres://admin:hunter2@db.internal/app";'); // security-scan: allow
  assert.equal(findings.some((finding) => finding.id === "credential-in-url"), true);
});

test("detects sensitive values passed to a logger", () => {
  const findings = scanText("logger.info({ phone: user.phone });"); // security-scan: allow
  assert.equal(findings.some((finding) => finding.id === "sensitive-log"), true);
});

test("rejects server-side secret concepts in mini-program source", () => {
  const findings = scanText("const sessionKey = response.sessionKey;", {
    isClient: true,
  });
  assert.equal(
    findings.some((finding) => finding.id === "client-secret-reference"),
    true,
  );
});

test("accepts environment lookups and redacted logging", () => {
  const content = [
    "const token = process.env.ACCESS_TOKEN;",
    'logger.info({ userId, phone: "[REDACTED]" }); // security-scan: allow',
  ].join("\n");
  assert.deepEqual(scanText(content), []);
});

test("allows placeholder credentials only for local example environments", () => {
  const value = "DATABASE_URL=postgres://demo:demo@127.0.0.1:5432/demo"; // security-scan: allow
  assert.deepEqual(scanText(value, { allowLocalExampleCredentials: true }), []);
  assert.equal(
    scanText(value).some((finding) => finding.id === "credential-in-url"),
    true,
  );
});

test("allows explicit token fixtures only when scanning tests", () => {
  const value = "const accessToken = 'issued-token';";
  assert.deepEqual(scanText(value, { allowTestFixtures: true }), []);
  assert.equal(
    scanText(value).some((finding) => finding.id === "assigned-secret"),
    true,
  );
});
