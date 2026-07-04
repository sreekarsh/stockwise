import { describe, it, before } from "node:test";
import assert from "node:assert";

describe("cryptoService", () => {
  let encrypt: (text: string) => string;
  let decrypt: (cipherText: string) => string;

  before(async () => {
    const mod = await import("../../services/cryptoService.js");
    encrypt = mod.encrypt;
    decrypt = mod.decrypt;
  });

  it("should encrypt and decrypt a message", () => {
    const plaintext = "my-api-key-12345";
    const encrypted = encrypt(plaintext);
    assert.ok(typeof encrypted === "string");
    assert.ok(encrypted.length > 0);
    assert.notStrictEqual(encrypted, plaintext);

    const decrypted = decrypt(encrypted);
    assert.strictEqual(decrypted, plaintext);
  });

  it("should produce different ciphertexts for same plaintext (IV random)", () => {
    const a = encrypt("hello");
    const b = encrypt("hello");
    assert.notStrictEqual(a, b);
  });

  it("should handle empty string", () => {
    assert.strictEqual(encrypt(""), "");
    assert.strictEqual(decrypt(""), "");
  });

  it("should throw on invalid ciphertext format", () => {
    assert.throws(() => decrypt("invalid-format"), {
      message: "Invalid ciphertext format for decryption",
    });
  });

  it("should throw on tampered ciphertext", () => {
    const encrypted = encrypt("secret-data");
    const parts = encrypted.split(":");
    parts[2] = parts[2].replace(/^.{4}/, "dead"); // corrupt the data
    assert.throws(() => decrypt(parts.join(":")));
  });

  it("should handle special characters", () => {
    const special = "hello_123!@#$%^&*()_+{}[]|;':\",./<>?`~";
    const encrypted = encrypt(special);
    assert.strictEqual(decrypt(encrypted), special);
  });

  it("should handle long plaintext", () => {
    const long = "a".repeat(10000);
    const encrypted = encrypt(long);
    assert.strictEqual(decrypt(encrypted), long);
  });
});

describe("mailService", () => {
  it("should export OWNER_EMAIL", async () => {
    const mod = await import("../../services/mailService.js");
    assert.ok(mod.OWNER_EMAIL);
    assert.ok(mod.OWNER_EMAIL.includes("@"));
  });

  it("should have sendOwnerEmail function", async () => {
    const mod = await import("../../services/mailService.js");
    assert.strictEqual(typeof mod.sendOwnerEmail, "function");
  });
});

describe("alertService", () => {
  it("should export startAlertEngine and stopAlertEngine", async () => {
    const mod = await import("../../services/alertService.js");
    assert.strictEqual(typeof mod.startAlertEngine, "function");
    assert.strictEqual(typeof mod.stopAlertEngine, "function");
  });
});
