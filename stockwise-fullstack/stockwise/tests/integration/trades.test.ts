import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Trade History", () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    await stopServer();
  });

  async function createUserAndAddHolding(req, symbol, name, quantity, buyPrice) {
    const id = uid();
    await req("POST", "/api/register", {
      username: `th_${symbol}_${id}`,
      email: `th_${symbol}_${id}@test.com`,
      password: "TestPass99!",
    });
    await req("POST", "/api/login", {
      email: `th_${symbol}_${id}@test.com`,
      password: "TestPass99!",
    });

    await req("POST", "/api/portfolio", {
      symbol,
      name,
      quantity,
      buy_price: buyPrice,
      asset_type: "crypto",
    });
  }

  describe("GET /api/trade-history", () => {
    it("should return an empty array for new users", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `thempty_${id}`,
        email: `thempty_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `thempty_${id}@test.com`,
        password: "TestPass99!",
      });

      const { status, data } = await req("GET", "/api/trade-history");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
      assert.strictEqual(data.length, 0);
    });

    it("should return formatted trade fields", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `thfmt_${id}`,
        email: `thfmt_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `thfmt_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "BTC",
        name: "Bitcoin",
        quantity: 1,
        buy_price: 5000000,
        asset_type: "crypto",
      });

      const { data } = await req("GET", "/api/trade-history");
      assert.ok(data.length >= 1);

      const trade = data[0];
      assert.ok(trade.time, "Trade should have a time field");
      assert.ok(trade.pair, "Trade should have a pair field");
      assert.ok(trade.type, "Trade should have a type field");
      assert.ok(trade.qty, "Trade should have a qty field");
      assert.ok(trade.price, "Trade should have a price field");
      assert.ok(trade.total, "Trade should have a total field");
    });

    it("should return trades in descending order (newest first)", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `thorder_${id}`,
        email: `thorder_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `thorder_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "BTC",
        name: "Bitcoin",
        quantity: 0.1,
        buy_price: 5000000,
        asset_type: "crypto",
      });

      await new Promise((r) => setTimeout(r, 10));

      await req("POST", "/api/portfolio", {
        symbol: "ETH",
        name: "Ethereum",
        quantity: 1,
        buy_price: 300000,
        asset_type: "crypto",
      });

      const { data } = await req("GET", "/api/trade-history");
      assert.ok(data.length >= 2);

      const times = data.map((t) => new Date(t.time).getTime());
      for (let i = 1; i < times.length; i++) {
        if (!isNaN(times[i - 1]) && !isNaN(times[i])) {
          assert.ok(
            times[i - 1] >= times[i],
            "Trades should be ordered newest first",
          );
        }
      }
    });

    it("should return trades for multiple symbols", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `thmulti_${id}`,
        email: `thmulti_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `thmulti_${id}@test.com`,
        password: "TestPass99!",
      });

      const coins = [
        { symbol: "SOL", qty: 10, price: 11000 },
        { symbol: "ADA", qty: 500, price: 45 },
        { symbol: "DOT", qty: 50, price: 720 },
      ];

      for (const c of coins) {
        await req("POST", "/api/portfolio", {
          symbol: c.symbol,
          name: c.symbol,
          quantity: c.qty,
          buy_price: c.price,
          asset_type: "crypto",
        });
      }

      const { data } = await req("GET", "/api/trade-history");
      for (const c of coins) {
        const found = data.filter((t) => t.pair === c.symbol);
        assert.ok(found.length >= 1, `Should have trades for ${c.symbol}`);
        const buyTrade = found.find((t) => t.type === "buy");
        assert.ok(buyTrade, `Should have buy trade for ${c.symbol}`);
        assert.strictEqual(Number(buyTrade.qty), c.qty);
      }
    });

    it("should reject when not logged in", async () => {
      const req = makeReq({ sessionCookie: "", csrfToken: "" });
      const { status, data } = await req("GET", "/api/trade-history");
      assert.strictEqual(status, 401);
      assert.strictEqual(data.error, "Not logged in");
    });
  });
});
