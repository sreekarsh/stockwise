import { describe, it, before } from "node:test";
import assert from "node:assert";

before(() => {
  process.env.SESSION_SECRET = "x".repeat(32);
  process.env.GMAIL_USER = "t@t.com";
  process.env.GMAIL_PASS = "p";
  process.env.COINGECKO_API_KEY = "k";
  process.env.DATABASE_URL = "postgresql://localhost:5432/test";
  process.env.ENCRYPTION_MASTER_KEY = "a".repeat(64);
});

describe("logger", () => {
  it("exports a pino logger instance", async () => {
    const log = (await import("../services/logger.js")).default;
    assert.ok(log);
    assert.strictEqual(typeof log.info, "function");
    assert.strictEqual(typeof log.error, "function");
    assert.strictEqual(typeof log.warn, "function");
  });

  it("logs info without throwing", async () => {
    const log = (await import("../services/logger.js")).default;
    log.info("test message");
  });
});
