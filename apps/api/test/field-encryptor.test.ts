import assert from "node:assert/strict";
import { it } from "node:test";
import { FieldEncryptor } from "../src/infrastructure/field-encryptor.js";

it("encrypts sensitive registration fields with randomized authenticated ciphertext", () => {
  const encryptor = new FieldEncryptor("test-field-encryption-key-with-at-least-32-characters");
  const first = encryptor.encrypt("13800006721");
  const second = encryptor.encrypt("13800006721");
  assert.notEqual(first, second);
  assert.ok(!first.includes("13800006721"));
  assert.equal(encryptor.decrypt(first), "13800006721");
  const tampered = `${first.slice(0, -1)}${first.endsWith("A") ? "B" : "A"}`;
  assert.throws(() => encryptor.decrypt(tampered));
});
