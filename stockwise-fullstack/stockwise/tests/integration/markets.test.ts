import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Market Data APIs", () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    await stopServer();
  });

  describe("GET /api/stocks", () => {
    it("should return an array of stocks", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/stocks");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length > 0);
    });

    it("should contain expected stock fields", async () => {
      const req = makeReq({});
      const { data } = await req("GET", "/api/stocks");
      const stock = data[0];
      assert.ok(stock.id);
      assert.ok(stock.symbol);
      assert.ok(stock.name);
      assert.ok(stock.current_price != null);
      assert.ok(stock.image);
    });

    it("should filter by category", async () => {
      const req = makeReq({});
      const { data } = await req("GET", "/api/stocks?category=nifty50");
      assert.ok(Array.isArray(data));
      if (data.length > 0) {
        data.forEach((s) => {
          assert.strictEqual(s.category, "nifty50");
        });
      }
    });

    it("should exclude crypto from stocks endpoint", async () => {
      const req = makeReq({});
      const { data } = await req("GET", "/api/stocks");
      const cryptos = data.filter((s) => s.category === "crypto");
      assert.strictEqual(cryptos.length, 0, "Stocks endpoint should not include crypto");
    });
  });

  describe("GET /api/rates", () => {
    it("should return USD/INR rate", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/rates");
      assert.strictEqual(status, 200);
      assert.ok(data.usd_inr, "Should have usd_inr field");
      assert.ok(data.usd_inr > 0, "Rate should be positive");
    });
  });

  describe("GET /api/health", () => {
    it("should return health status", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/health");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.status, "ok");
      assert.ok(data.timestamp);
      assert.ok(data.database);
      assert.ok(data.uptime);
    });
  });

  describe("GET /api/markets", () => {
    it("should return market data array", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/markets?per_page=10");
      assert.strictEqual(status, 200);
      if (Array.isArray(data)) {
        if (data.length > 0) {
          assert.ok(data[0].symbol);
          assert.ok(data[0].current_price != null);
        }
      }
    });
  });

  describe("GET /stocks/:symbol/chart", () => {
    it("should return chart prices array", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/stocks/RELIANCE/chart?days=7");
      assert.strictEqual(status, 200);
      assert.ok(data.prices);
      assert.ok(Array.isArray(data.prices));
    });

    it("should return empty array for unknown symbol", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/stocks/NONEXIST/chart");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.prices));
      assert.strictEqual(data.prices.length, 0);
    });
  });

  describe("GET /signals", () => {
    it("should return signals page", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/signals");
      assert.strictEqual(status, 200);
    });
  });

  describe("GET /api/signals", () => {
    it("should return signal data array", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/signals?count=5");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length <= 5);
    });
  });
});
