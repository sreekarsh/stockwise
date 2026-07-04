import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, createAuthedUser } from "../helpers.js";

describe("Alerts APIs", () => {
  let authed;

  before(async () => {
    await startServer();
    authed = await createAuthedUser();
  });

  after(async () => {
    await stopServer();
  });

  describe("POST /api/webhooks/tradingview", () => {
    it("should reject missing passphrase (Zod catches it first)", async () => {
      const req = makeReq({});
      const { status, data } = await req("POST", "/api/webhooks/tradingview", {
        symbol: "BTC", action: "buy", price: 50000
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should reject wrong passphrase", async () => {
      const req = makeReq({});
      const { status, data } = await req("POST", "/api/webhooks/tradingview", {
        passphrase: "wrong", symbol: "BTC", action: "buy", price: 50000
      });
      assert.strictEqual(status, 401);
      assert.ok(data.error);
    });

    it("should reject invalid symbol", async () => {
      const req = makeReq({});
      const { status, data } = await req("POST", "/api/webhooks/tradingview", {
        passphrase: "stockwise_secret", symbol: "", action: "buy", price: 50000
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });

  describe("GET /api/alerts", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/alerts");
      assert.strictEqual(status, 401);
    });

    it("should return empty list initially", async () => {
      const { status, data } = await authed.req("GET", "/api/alerts");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  describe("POST /api/alerts", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/alerts", {
        symbol: "BTC", target_price: 100000, direction: "above"
      });
      assert.strictEqual(status, 403);
    });

    it("should reject invalid symbol", async () => {
      const { status, data } = await authed.req("POST", "/api/alerts", {
        symbol: "", target_price: 100000, direction: "above"
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should reject invalid direction", async () => {
      const { status, data } = await authed.req("POST", "/api/alerts", {
        symbol: "BTC", target_price: 100000, direction: "sideways"
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should create a new alert", async () => {
      const { status, data } = await authed.req("POST", "/api/alerts", {
        symbol: "BTC", target_price: 100000, direction: "above"
      });
      assert.strictEqual(status, 200);
      assert.ok(data.alert);
      assert.ok(data.alert.id);
      assert.strictEqual(data.alert.symbol, "BTC");
    });
  });

  describe("DELETE /api/alerts/:id", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", "/api/alerts/99999");
      assert.strictEqual(status, 403);
    });

    it("should return 404 for non-existent alert", async () => {
      const { status, data } = await authed.req("DELETE", "/api/alerts/99999");
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });

    it("should delete an owned alert", async () => {
      const createRes = await authed.req("POST", "/api/alerts", {
        symbol: "ETH", target_price: 999999, direction: "above"
      });
      const alertId = createRes.data.alert.id;

      const { status } = await authed.req("DELETE", `/api/alerts/${alertId}`);
      assert.strictEqual(status, 200);
    });
  });
});
