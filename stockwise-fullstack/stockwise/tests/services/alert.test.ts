import { describe, it, before, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert";

describe("alertService", () => {
  let mod: any;
  let updateMock: ReturnType<typeof mock.fn>;

  before(async () => {
    const dbMod = await import("../../services/db.js");
    const wsMod = await import("../../services/websocketService.js");

    updateMock = mock.fn(() => Promise.resolve({}));
    const prismaClient = (dbMod as any).default;
    prismaClient.alert = {
      findMany: mock.fn(() => Promise.resolve([])),
      update: updateMock,
    };

    // latestPrices is a const object – mutate its properties
    const prices = (wsMod as any).latestPrices;
    Object.keys(prices).forEach((k) => delete prices[k]);
    prices.BTC = 50000;
    prices.ETH = 3000;

    const url = new URL("../../services/alertService.js", import.meta.url).href;
    mod = await import(url + "?alert=1");
  });

  afterEach(() => {
    try { mod.stopAlertEngine(); } catch { /* ok */ }
  });

  describe("normalizeSymbol", () => {
    it("converts to uppercase", () => {
      assert.strictEqual(mod.normalizeSymbol("btc"), "BTC");
    });
    it("strips USDT suffix", () => {
      assert.strictEqual(mod.normalizeSymbol("btcusdt"), "BTC");
    });
    it("handles already clean symbol", () => {
      assert.strictEqual(mod.normalizeSymbol("ETH"), "ETH");
    });
  });

  describe("checkAlerts", () => {
    beforeEach(() => { updateMock.mock.resetCalls(); });

    it("does nothing when no alerts", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() => Promise.resolve([]));
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 0);
    });

    it("skips alerts without matching price", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() =>
        Promise.resolve([{ id: 1, symbol: "XRPUSDT", target_price: 2, direction: "above", triggered: 0, user_id: 1, user: { username: "alice" } }])
      );
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 0);
    });

    it("triggers when price above target", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() =>
        Promise.resolve([{ id: 1, symbol: "BTCUSDT", target_price: 45000, direction: "above", triggered: 0, user_id: 1, user: { username: "alice" } }])
      );
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 1);
    });

    it("triggers when price below target", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() =>
        Promise.resolve([{ id: 2, symbol: "ETHUSDT", target_price: 3500, direction: "below", triggered: 0, user_id: 2, user: { username: "bob" } }])
      );
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 1);
    });

    it("does not trigger when condition not met", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() =>
        Promise.resolve([{ id: 3, symbol: "BTCUSDT", target_price: 60000, direction: "above", triggered: 0, user_id: 1, user: { username: "alice" } }])
      );
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 0);
    });

    it("handles exceptions gracefully", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() => Promise.reject(new Error("db error")));
      await mod.checkAlerts();
      assert.strictEqual(updateMock.mock.calls.length, 0);
    });
  });

  describe("startAlertEngine", () => {
    it("calls checkAlerts once on start", async () => {
      const dbMod = await import("../../services/db.js");
      dbMod.default.alert.findMany = mock.fn(() => Promise.resolve([]));
      await mod.startAlertEngine();
      assert.strictEqual(dbMod.default.alert.findMany.mock.calls.length, 1);
      mod.stopAlertEngine();
    });
  });
});
