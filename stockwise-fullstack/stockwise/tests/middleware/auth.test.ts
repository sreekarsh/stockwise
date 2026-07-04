import { describe, it, before, after, mock } from "node:test";
import assert from "node:assert";

process.env.REDIS_URL = "redis://127.0.0.1:1";

function makeMockRedisClient() {
  return {
    isOpen: true,
    isReady: true,
    incr: mock.fn(() => Promise.resolve(1)),
    expire: mock.fn(() => Promise.resolve(true)),
    hGetAll: mock.fn(() => Promise.resolve({})),
    hSet: mock.fn(() => Promise.resolve("OK")),
    del: mock.fn(() => Promise.resolve(1)),
    on: mock.fn(() => {}),
    connect: mock.fn(() => Promise.resolve()),
  };
}

describe("auth middleware", () => {
  let rateLimit: (opts?: any) => (req: any, res: any, next: any) => Promise<void>;
  let requireAuth: (req: any, res: any, next: any) => void;
  let checkLockout: (req: any, res: any, next: any) => Promise<void>;
  let recordFailedAttempt: (ip: string) => Promise<void>;
  let resetFailedAttempts: (ip: string) => Promise<void>;
  let mockRedis: ReturnType<typeof makeMockRedisClient>;
  let setRedisClient: (c: any) => void;

  before(async () => {
    const mod = await import("../../middleware/auth.js");
    rateLimit = mod.rateLimit;
    requireAuth = mod.requireAuth;
    checkLockout = mod.checkLockout;
    recordFailedAttempt = mod.recordFailedAttempt;
    resetFailedAttempts = mod.resetFailedAttempts;

    const redisMod = await import("../../services/redis.js");
    setRedisClient = redisMod.__setRedisClient;
    mockRedis = makeMockRedisClient();
  });

  after(() => {
    setRedisClient(null);
  });

  describe("rateLimit", () => {
    it("should allow requests under the limit (memory fallback)", async () => {
      const limiter = rateLimit({ windowMs: 60000, max: 5 });
      let called = false;
      await limiter(
        { ip: "127.0.0.1", path: "/test", socket: { remoteAddress: "127.0.0.1" } } as any,
        {} as any,
        () => { called = true; },
      );
      assert.ok(called);
    });

    it("should block requests over the limit (memory fallback)", async () => {
      const limiter = rateLimit({ windowMs: 60000, max: 2 });
      let statusCode = 0;
      let jsonData: any = null;
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      const req: any = { ip: "127.0.0.2", path: "/test-limit", socket: { remoteAddress: "127.0.0.2" } };
      await limiter(req, res, () => {});
      await limiter(req, res, () => {});
      await limiter(req, res, () => {});
      assert.strictEqual(statusCode, 429);
      assert.ok(jsonData.error);
    });

    it("passes through when under limit (Redis path)", async () => {
      setRedisClient(mockRedis);
      mockRedis.incr = mock.fn(() => Promise.resolve(1));
      let called = false;
      await rateLimit({ windowMs: 60000, max: 5 })(
        { ip: "10.0.0.1", path: "/api/test", socket: { remoteAddress: "10.0.0.1" } },
        {} as any,
        () => { called = true; },
      );
      assert.strictEqual(called, true);
      assert.strictEqual(mockRedis.expire.mock.calls.length, 1);
      setRedisClient(null);
    });

    it("blocks requests over limit (Redis path)", async () => {
      setRedisClient(mockRedis);
      mockRedis.incr = mock.fn(() => Promise.resolve(999));
      let statusCode = 0;
      const res: any = { status: (c: number) => { statusCode = c; return res; }, json: () => {} };
      await rateLimit({ windowMs: 60000, max: 100 })(
        { ip: "10.0.0.2", path: "/api/test2", socket: { remoteAddress: "10.0.0.2" } },
        res,
        () => {},
      );
      assert.strictEqual(statusCode, 429);
      setRedisClient(null);
    });

    it("falls back to memory on Redis error", async () => {
      setRedisClient(mockRedis);
      mockRedis.incr = mock.fn(() => Promise.reject(new Error("conn lost")));
      let called = false;
      await rateLimit({ windowMs: 60000, max: 5 })(
        { ip: "10.0.0.3", path: "/api/test3", socket: { remoteAddress: "10.0.0.3" } },
        {} as any,
        () => { called = true; },
      );
      assert.strictEqual(called, true);
      setRedisClient(null);
    });
  });

  describe("requireAuth", () => {
    it("should return 401 if no session", () => {
      let statusCode = 0;
      let jsonData: any = null;
      const req: any = { session: undefined };
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      requireAuth(req, res, () => {});
      assert.strictEqual(statusCode, 401);
      assert.strictEqual(jsonData.error, "Not logged in");
    });

    it("should return 401 if session has no userId", () => {
      let statusCode = 0;
      let jsonData: any = null;
      const req: any = { session: {} };
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      requireAuth(req, res, () => {});
      assert.strictEqual(statusCode, 401);
    });

    it("should call next if userId is present", () => {
      const req: any = { session: { userId: 1 } };
      const res: any = { status: () => res, json: () => {} };
      let called = false;
      requireAuth(req, res, () => { called = true; });
      assert.ok(called);
    });
  });

  describe("checkLockout", () => {
    it("should allow requests when not locked out (memory)", async () => {
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const req: any = { ip: "127.0.0.100", path: "/login", socket: { remoteAddress: "127.0.0.100" } };
      let called = false;
      await checkLockout(req, {} as any, () => { called = true; });
      process.env.NODE_ENV = orig;
      assert.ok(called);
    });

    it("should block requests when locked out (memory)", async () => {
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const ip = "127.0.0.101";
      for (let i = 0; i < 6; i++) {
        await recordFailedAttempt(ip);
      }
      let statusCode = 0;
      let jsonData: any = null;
      const req: any = { ip, path: "/login", socket: { remoteAddress: ip } };
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      await checkLockout(req, res, () => {});
      process.env.NODE_ENV = orig;
      assert.strictEqual(statusCode, 403);
      assert.ok(jsonData.error.includes("Locked out"));
    });

    it("passes when not locked out (Redis)", async () => {
      setRedisClient(mockRedis);
      mockRedis.hGetAll = mock.fn(() => Promise.resolve({}));
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      let called = false;
      await checkLockout(
        { ip: "10.0.0.10", path: "/login", socket: { remoteAddress: "10.0.0.10" } },
        {} as any,
        () => { called = true; },
      );
      process.env.NODE_ENV = orig;
      assert.strictEqual(called, true);
      setRedisClient(null);
    });

    it("blocks when locked out (Redis)", async () => {
      setRedisClient(mockRedis);
      const future = Date.now() + 600000;
      mockRedis.hGetAll = mock.fn(() =>
        Promise.resolve({ attempts: "5", lockedUntil: String(future) })
      );
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      let statusCode = 0;
      const res: any = { status: (c: number) => { statusCode = c; return res; }, json: () => {} };
      await checkLockout(
        { ip: "10.0.0.11", path: "/login", socket: { remoteAddress: "10.0.0.11" } },
        res,
        () => {},
      );
      process.env.NODE_ENV = orig;
      assert.strictEqual(statusCode, 403);
      setRedisClient(null);
    });

    it("falls back to memory on Redis error", async () => {
      setRedisClient(mockRedis);
      mockRedis.hGetAll = mock.fn(() => Promise.reject(new Error("conn lost")));
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      let called = false;
      await checkLockout(
        { ip: "10.0.0.12", path: "/login", socket: { remoteAddress: "10.0.0.12" } },
        {} as any,
        () => { called = true; },
      );
      process.env.NODE_ENV = orig;
      assert.strictEqual(called, true);
      setRedisClient(null);
    });
  });

  describe("recordFailedAttempt", () => {
    it("records first attempt (Redis)", async () => {
      setRedisClient(mockRedis);
      mockRedis.hGetAll = mock.fn(() => Promise.resolve({}));
      mockRedis.hSet = mock.fn(() => Promise.resolve("OK"));
      mockRedis.expire = mock.fn(() => Promise.resolve(true));
      await recordFailedAttempt("10.0.0.20");
      assert.strictEqual(mockRedis.hSet.mock.calls.length, 1);
      const args = mockRedis.hSet.mock.calls[0].arguments;
      assert.strictEqual(args[0], "login_lockout:10.0.0.20");
      assert.strictEqual(args[1].attempts, "1");
      setRedisClient(null);
    });

    it("locks out after 5 attempts (Redis)", async () => {
      setRedisClient(mockRedis);
      mockRedis.hGetAll = mock.fn(() =>
        Promise.resolve({ attempts: "4", lockedUntil: "0" })
      );
      mockRedis.hSet = mock.fn(() => Promise.resolve("OK"));
      await recordFailedAttempt("10.0.0.21");
      const args = mockRedis.hSet.mock.calls[0].arguments;
      assert.strictEqual(args[1].attempts, "5");
      assert.ok(parseInt(args[1].lockedUntil, 10) > Date.now());
      setRedisClient(null);
    });

    it("resets when lockout expired (Redis)", async () => {
      setRedisClient(mockRedis);
      const past = Date.now() - 60000;
      mockRedis.hGetAll = mock.fn(() =>
        Promise.resolve({ attempts: "5", lockedUntil: String(past) })
      );
      mockRedis.hSet = mock.fn(() => Promise.resolve("OK"));
      await recordFailedAttempt("10.0.0.22");
      const args = mockRedis.hSet.mock.calls[0].arguments;
      assert.strictEqual(args[1].attempts, "1");
      assert.strictEqual(args[1].lockedUntil, "0");
      setRedisClient(null);
    });

    it("falls back to memory on Redis error", async () => {
      setRedisClient(mockRedis);
      mockRedis.hGetAll = mock.fn(() => Promise.reject(new Error("conn lost")));
      await recordFailedAttempt("10.0.0.23");
      assert.ok(true);
      setRedisClient(null);
    });
  });

  describe("resetFailedAttempts", () => {
    it("deletes the key (Redis)", async () => {
      setRedisClient(mockRedis);
      mockRedis.del = mock.fn(() => Promise.resolve(1));
      await resetFailedAttempts("10.0.0.30");
      assert.strictEqual(mockRedis.del.mock.calls.length, 1);
      const args = mockRedis.del.mock.calls[0].arguments;
      assert.strictEqual(args[0], "login_lockout:10.0.0.30");
      setRedisClient(null);
    });

    it("falls back to memory on Redis error", async () => {
      setRedisClient(mockRedis);
      mockRedis.del = mock.fn(() => Promise.reject(new Error("conn lost")));
      await resetFailedAttempts("10.0.0.31");
      assert.ok(true);
      setRedisClient(null);
    });

    it("should clear lockout after reset (memory)", async () => {
      const orig = process.env.NODE_ENV;
      process.env.NODE_ENV = "development";
      const ip = "127.0.0.102";
      for (let i = 0; i < 6; i++) {
        await recordFailedAttempt(ip);
      }
      await resetFailedAttempts(ip);
      let called = false;
      const req: any = { ip, path: "/login", socket: { remoteAddress: ip } };
      await checkLockout(req, {} as any, () => { called = true; });
      process.env.NODE_ENV = orig;
      assert.ok(called);
    });
  });
});
