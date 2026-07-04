import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, createAuthedUser } from "../helpers.js";

describe("Demo Bots APIs", () => {
  let authed;

  before(async () => {
    await startServer();
    authed = await createAuthedUser();
  });

  after(async () => {
    await stopServer();
  });

  describe("GET /api/demo/account", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/demo/account");
      assert.strictEqual(status, 401);
    });

    it("should return demo account with default balance", async () => {
      const { status, data } = await authed.req("GET", "/api/demo/account");
      assert.strictEqual(status, 200);
      assert.ok(data.balance >= 0);
      assert.ok(data.level !== undefined);
    });
  });

  describe("POST /api/demo/trade", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/demo/trade", { symbol: "BTC", type: "BUY", quantity: 1, price: 100 });
      assert.strictEqual(status, 403);
    });

    it("should execute a BUY trade", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/trade", { symbol: "BTC", type: "BUY", quantity: 0.1, price: 50000 });
      assert.strictEqual(status, 200);
      assert.ok(data.message);
    });

    it("should reject invalid symbol", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/trade", { symbol: "", type: "BUY", quantity: 1, price: 100 });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should reject invalid trade type", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/trade", { symbol: "BTC", type: "INVALID", quantity: 1, price: 100 });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });

  describe("POST /api/demo/reset", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/demo/reset");
      assert.strictEqual(status, 403);
    });

    it("should reset demo account", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/reset");
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("GET /api/demo/bots", () => {
    it("should return empty list initially", async () => {
      const { status, data } = await authed.req("GET", "/api/demo/bots");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  describe("Bot CRUD", () => {
    let botId;

    it("should reject unauthenticated create", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/demo/bots/create", { name: "test", strategy: "RSI_BOT", symbol: "BTC" });
      assert.strictEqual(status, 403);
    });

    it("should reject empty name", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/bots/create", { name: "", strategy: "RSI_BOT", symbol: "BTC" });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should create a new bot", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/bots/create", { name: "TestBot", strategy: "RSI_BOT", symbol: "BTC" });
      assert.strictEqual(status, 200);
      assert.ok(data.botId != null);
      botId = data.botId;
    });

    it("should toggle bot status", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/bots/toggle", { botId, status: "active" });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should reject negative botId (Prisma FK error -> 500)", async () => {
      const { status } = await authed.req("POST", "/api/demo/bots/toggle", { botId: -1, status: "active" });
      assert.strictEqual(status, 500);
    });

    it("should return logs for bot", async () => {
      const { status, data } = await authed.req("GET", `/api/demo/bots/logs?botId=${botId}`);
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });

    it("should delete the bot", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/bots/delete", { botId });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("POST /api/demo/academy/complete", () => {
    it("should allow guest (no auth required)", async () => {
      const req = makeReq({});
      const { status, data } = await req("POST", "/api/demo/academy/complete", { lessonId: "lesson_1" });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.guest, true);
      assert.strictEqual(data.success, true);
    });

    it("should complete a lesson for logged-in user", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/academy/complete", { lessonId: "lesson_1" });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should reject empty lessonId", async () => {
      const { status, data } = await authed.req("POST", "/api/demo/academy/complete", { lessonId: "" });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });
});
