import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert";

describe("redis service", () => {
  let redisModule: any;
  let realClient: any;

  before(async () => {
    redisModule = await import("../../services/redis.js");
    // Grab a reference to the real client so we can quit it later
    realClient = redisModule.redisClient;
  });

  after(async () => {
    redisModule.__setRedisClient(null);
    if (realClient && typeof realClient.quit === "function") {
      try { await realClient.quit(); } catch { /* ok */ }
    }
  });

  it("waitForRedis returns null when client is null", async () => {
    redisModule.__setRedisClient(null);
    const r = await redisModule.waitForRedis();
    assert.strictEqual(r, null);
  });

  it("waitForRedis returns client when isReady", async () => {
    const mock = { isReady: true };
    redisModule.__setRedisClient(mock);
    const r = await redisModule.waitForRedis();
    assert.strictEqual(r, mock);
    redisModule.__setRedisClient(null);
  });

  it("waitForRedis returns null when not ready", async () => {
    const mock = { isReady: false };
    redisModule.__setRedisClient(mock);
    const r = await redisModule.waitForRedis();
    assert.strictEqual(r, null);
    redisModule.__setRedisClient(null);
  });
});
