import { describe, it, before } from "node:test";
import assert from "node:assert";

let env: any;

before(async () => {
  // Ensure required env vars are set before importing
  process.env.SESSION_SECRET ??= "x".repeat(32);
  process.env.GMAIL_USER ??= "t@t.com";
  process.env.GMAIL_PASS ??= "p";
  process.env.COINGECKO_API_KEY ??= "k";
  process.env.ENCRYPTION_MASTER_KEY ??= "a".repeat(64);
  const mod = await import("../config/env.js");
  env = mod.env;
});

describe("env schema", () => {
  it("parses SESSION_SECRET as string", () => {
    assert.ok(typeof env.SESSION_SECRET === "string");
  });

  it("parses PORT as number", () => {
    assert.strictEqual(typeof env.PORT, "number");
  });

  it("parses ML_PORT as number", () => {
    assert.strictEqual(typeof env.ML_PORT, "number");
  });

  it("parses NODE_ENV as valid enum value", () => {
    assert.ok(["development", "production", "test"].includes(env.NODE_ENV));
  });

  it("parses REDIS_URL as string", () => {
    assert.ok(typeof env.REDIS_URL === "string");
  });
});
