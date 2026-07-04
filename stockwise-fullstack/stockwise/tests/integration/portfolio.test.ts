import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Portfolio CRUD", () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    await stopServer();
  });

  describe("POST /api/portfolio — Add holdings", () => {
    it("should add a new BTC holding", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `padd_${id}`,
        email: `padd_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `padd_${id}@test.com`,
        password: "TestPass99!",
      });

      const { status, data } = await req("POST", "/api/portfolio", {
        symbol: "BTC",
        name: "Bitcoin",
        quantity: 0.5,
        buy_price: 4500000,
        asset_type: "crypto",
      });

      assert.strictEqual(status, 200);
      assert.strictEqual(data.success, true);
    });

    it("should retrieve the newly added holding via GET", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pget_${id}`,
        email: `pget_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pget_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "ETH",
        name: "Ethereum",
        quantity: 2.0,
        buy_price: 298000,
        asset_type: "crypto",
      });

      const { status, data } = await req("GET", "/api/portfolio");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
      assert.ok(data.length >= 1);
      const eth = data.find((h) => h.symbol === "ETH");
      assert.ok(eth, "ETH should exist in portfolio");
      assert.strictEqual(eth.name, "Ethereum");
      assert.strictEqual(eth.quantity, 2.0);
      assert.strictEqual(eth.buy_price, 298000);
      assert.strictEqual(eth.asset_type, "crypto");
    });

    it("should upsert same symbol (update quantity)", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pups_${id}`,
        email: `pups_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pups_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "SOL",
        name: "Solana",
        quantity: 10,
        buy_price: 11000,
        asset_type: "crypto",
      });

      await req("POST", "/api/portfolio", {
        symbol: "SOL",
        name: "Solana",
        quantity: 25,
        buy_price: 11000,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const sol = holdings.find((h) => h.symbol === "SOL");
      assert.ok(sol, "SOL should exist");
      assert.strictEqual(sol.quantity, 25, "Quantity should be updated to 25");
    });

    it("should create a trade_history entry on add", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `ptrade_${id}`,
        email: `ptrade_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `ptrade_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "ADA",
        name: "Cardano",
        quantity: 500,
        buy_price: 45,
        asset_type: "crypto",
      });

      const { data: trades } = await req("GET", "/api/trade-history");
      const adaTrades = trades.filter((t) => t.pair === "ADA");
      assert.ok(adaTrades.length >= 1, "Should have at least one trade for ADA");
      const buyTrade = adaTrades.find((t) => t.type === "buy");
      assert.ok(buyTrade, "Should have a buy trade entry");
      assert.strictEqual(Number(buyTrade.qty), 500);
      assert.strictEqual(Number(buyTrade.price), 45);
    });

    it("should reject add when not logged in", async () => {
      const req = makeReq({ sessionCookie: "", csrfToken: "" });
      const { status, data } = await req("POST", "/api/portfolio", {
        symbol: "BTC",
        name: "Bitcoin",
        quantity: 1,
        buy_price: 50000,
        asset_type: "crypto",
      });
      assert.strictEqual(status, 401);
      assert.strictEqual(data.error, "Not logged in");
    });

    it("should reject add with missing fields", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pmiss_${id}`,
        email: `pmiss_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pmiss_${id}@test.com`,
        password: "TestPass99!",
      });

      const { status } = await req("POST", "/api/portfolio", {
        symbol: "",
        name: "",
        quantity: 0,
        buy_price: 0,
      });

      assert.strictEqual(status, 500);
    });
  });

  describe("PUT /api/portfolio/:id — Edit holdings", () => {
    it("should update holding quantity", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pedit_${id}`,
        email: `pedit_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pedit_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "DOT",
        name: "Polkadot",
        quantity: 100,
        buy_price: 720,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const dot = holdings.find((h) => h.symbol === "DOT");
      assert.ok(dot);

      const { status } = await req("PUT", `/api/portfolio/${dot.id}`, {
        quantity: 150,
      });
      assert.strictEqual(status, 200);

      const { data: updated } = await req("GET", "/api/portfolio");
      const dot2 = updated.find((h) => h.symbol === "DOT");
      assert.strictEqual(dot2.quantity, 150);
    });

    it("should update holding buy_price", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pba_${id}`,
        email: `pba_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pba_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "LINK",
        name: "Chainlink",
        quantity: 50,
        buy_price: 1800,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const link = holdings.find((h) => h.symbol === "LINK");

      await req("PUT", `/api/portfolio/${link.id}`, {
        buy_price: 2000,
      });

      const { data: updated } = await req("GET", "/api/portfolio");
      const link2 = updated.find((h) => h.symbol === "LINK");
      assert.strictEqual(link2.buy_price, 2000);
    });

    it("should create trade entry when quantity changes", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `ptrup_${id}`,
        email: `ptrup_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `ptrup_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "ATOM",
        name: "Cosmos",
        quantity: 30,
        buy_price: 1200,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const atom = holdings.find((h) => h.symbol === "ATOM");

      await req("PUT", `/api/portfolio/${atom.id}`, {
        quantity: 50,
        buy_price: 1200,
      });

      const { data: trades } = await req("GET", "/api/trade-history");
      const atomTrades = trades.filter((t) => t.pair === "ATOM" && t.type === "buy");
      assert.ok(atomTrades.length >= 2, "Should have original add + update trades");
      const buyAmounts = atomTrades.reduce((s, t) => s + Number(t.qty), 0);
      assert.strictEqual(buyAmounts, 50, "Total bought should be 50");
    });
  });

  describe("DELETE /api/portfolio/:id — Remove holdings", () => {
    it("should delete a holding", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pdel_${id}`,
        email: `pdel_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pdel_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "AVAX",
        name: "Avalanche",
        quantity: 15,
        buy_price: 3500,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const avax = holdings.find((h) => h.symbol === "AVAX");
      assert.ok(avax);

      const { status } = await req("DELETE", `/api/portfolio/${avax.id}`);
      assert.strictEqual(status, 200);

      const { data: after } = await req("GET", "/api/portfolio");
      const gone = after.find((h) => h.symbol === "AVAX");
      assert.ok(!gone, "AVAX should no longer exist in portfolio");
    });

    it("should create sell trade entry on delete", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `pdsell_${id}`,
        email: `pdsell_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `pdsell_${id}@test.com`,
        password: "TestPass99!",
      });

      await req("POST", "/api/portfolio", {
        symbol: "NEAR",
        name: "NEAR Protocol",
        quantity: 40,
        buy_price: 650,
        asset_type: "crypto",
      });

      const { data: holdings } = await req("GET", "/api/portfolio");
      const near = holdings.find((h) => h.symbol === "NEAR");

      await req("DELETE", `/api/portfolio/${near.id}`);

      const { data: trades } = await req("GET", "/api/trade-history");
      const nearSells = trades.filter(
        (t) => t.pair === "NEAR" && t.type === "sell",
      );
      assert.ok(nearSells.length >= 1, "Delete should create sell trade");
    });

    it("should reject delete when not logged in", async () => {
      const req = makeReq({ sessionCookie: "", csrfToken: "" });
      const { status } = await req("DELETE", "/api/portfolio/99999");
      assert.strictEqual(status, 401);
    });
  });

  describe("End-to-end: Buy flow simulation", () => {
    it("should add then display up-to-date holdings list", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();

      await req("POST", "/api/register", {
        username: `flow_${id}`,
        email: `flow_${id}@test.com`,
        password: "TestPass99!",
      });
      await req("POST", "/api/login", {
        email: `flow_${id}@test.com`,
        password: "TestPass99!",
      });

      const newCoins = [
        { symbol: "XRP", name: "Ripple", quantity: 1000, buy_price: 48 },
        { symbol: "DOGE", name: "Dogecoin", quantity: 5000, buy_price: 12 },
        { symbol: "MATIC", name: "Polygon", quantity: 200, buy_price: 85 },
      ];

      for (const coin of newCoins) {
        const { status, data } = await req("POST", "/api/portfolio", {
          ...coin,
          asset_type: "crypto",
        });
        assert.strictEqual(
          status,
          200,
          `Failed to add ${coin.symbol}: ${data.error || status}`,
        );
      }

      const { data: holdings } = await req("GET", "/api/portfolio");
      assert.strictEqual(
        holdings.length >= 3,
        true,
        `Expected 3+ holdings, got ${holdings.length}`,
      );

      for (const coin of newCoins) {
        const match = holdings.find((h) => h.symbol === coin.symbol);
        assert.ok(match, `${coin.symbol} should appear in portfolio`);
        assert.strictEqual(match.quantity, coin.quantity);
        assert.strictEqual(match.name, coin.name);
        assert.strictEqual(match.buy_price, coin.buy_price);
      }

      const { data: trades } = await req("GET", "/api/trade-history");
      for (const coin of newCoins) {
        const coinTrades = trades.filter((t) => t.pair === coin.symbol);
        assert.ok(
          coinTrades.length >= 1,
          `${coin.symbol} should have trade history`,
        );
      }
    });
  });
});
