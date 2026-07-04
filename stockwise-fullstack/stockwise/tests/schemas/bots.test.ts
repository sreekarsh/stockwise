import { describe, it } from "node:test";
import assert from "node:assert";
import {
  tradeSchema,
  botCreateSchema,
  botToggleSchema,
  botDeleteSchema,
  academyCompleteSchema,
} from "../../schemas/bots.js";

describe("tradeSchema", () => {
  it("accepts valid trade", () => {
    const result = tradeSchema.safeParse({
      symbol: "BTC",
      type: "BUY",
      quantity: "0.5",
      price: 45000,
    });
    assert.ok(result.success);
  });

  it("transforms string quantity to number", () => {
    const result = tradeSchema.safeParse({
      symbol: "ETH",
      type: "SELL",
      quantity: "2",
      price: "3000",
    });
    assert.ok(result.success);
    assert.strictEqual(typeof result.data!.quantity, "number");
    assert.strictEqual(typeof result.data!.price, "number");
  });

  it("rejects invalid type", () => {
    const result = tradeSchema.safeParse({
      symbol: "BTC",
      type: "HOLD",
      quantity: 1,
      price: 100,
    });
    assert.ok(!result.success);
  });

  it("rejects empty symbol", () => {
    const result = tradeSchema.safeParse({
      symbol: "",
      type: "BUY",
      quantity: 1,
      price: 100,
    });
    assert.ok(!result.success);
  });
});

describe("botCreateSchema", () => {
  it("accepts valid RSI_BOT config", () => {
    const result = botCreateSchema.safeParse({
      name: "My RSI Bot",
      strategy: "RSI_BOT",
      symbol: "BTC",
    });
    assert.ok(result.success);
    if (result.success) {
      assert.strictEqual(result.data.strategy, "RSI_BOT");
      assert.deepStrictEqual(result.data.parameters, {
        buy_threshold: 35,
        sell_threshold: 65,
      });
    }
  });

  it("accepts RSI_BOT with custom params", () => {
    const result = botCreateSchema.safeParse({
      name: "Aggressive RSI",
      strategy: "RSI_BOT",
      symbol: "ETH",
      parameters: { buy_threshold: 30, sell_threshold: 70 },
    });
    assert.ok(result.success);
  });

  it("accepts valid MACD_BOT config", () => {
    const result = botCreateSchema.safeParse({
      name: "MACD Bot",
      strategy: "MACD_BOT",
      symbol: "SOL",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.strategy, "MACD_BOT");
  });

  it("accepts valid GRID_BOT config", () => {
    const result = botCreateSchema.safeParse({
      name: "Grid Bot",
      strategy: "GRID_BOT",
      symbol: "ADA",
    });
    assert.ok(result.success);
    if (result.success) {
      assert.strictEqual(result.data.strategy, "GRID_BOT");
      assert.strictEqual(result.data.parameters.grid_percent, 1.5);
    }
  });

  it("accepts GRID_BOT with custom grid_percent", () => {
    const result = botCreateSchema.safeParse({
      name: "Tight Grid",
      strategy: "GRID_BOT",
      symbol: "XRP",
      parameters: { grid_percent: 2.5 },
    });
    assert.ok(result.success);
    if (result.success) {
      assert.strictEqual(result.data.parameters.grid_percent, 2.5);
    }
  });

  it("rejects invalid strategy name", () => {
    const result = botCreateSchema.safeParse({
      name: "Bot",
      strategy: "INVALID_STRATEGY",
      symbol: "BTC",
    });
    assert.ok(!result.success);
  });

  it("rejects missing name", () => {
    const result = botCreateSchema.safeParse({
      strategy: "RSI_BOT",
      symbol: "BTC",
    });
    assert.ok(!result.success);
  });
});

describe("botToggleSchema", () => {
  it("accepts valid toggle with number", () => {
    const result = botToggleSchema.safeParse({
      botId: 1,
      status: "active",
    });
    assert.ok(result.success);
  });

  it("transforms string botId to number", () => {
    const result = botToggleSchema.safeParse({
      botId: "42",
      status: "paused",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.botId, 42);
  });

  it("rejects invalid status", () => {
    const result = botToggleSchema.safeParse({
      botId: 1,
      status: "invalid_status",
    });
    assert.ok(!result.success);
  });
});

describe("botDeleteSchema", () => {
  it("accepts valid delete", () => {
    const result = botDeleteSchema.safeParse({ botId: 5 });
    assert.ok(result.success);
  });

  it("transforms string botId", () => {
    const result = botDeleteSchema.safeParse({ botId: "10" });
    assert.ok(result.success);
    assert.strictEqual(result.data!.botId, 10);
  });
});

describe("academyCompleteSchema", () => {
  it("accepts valid lesson completion", () => {
    const result = academyCompleteSchema.safeParse({ lessonId: "lesson-1" });
    assert.ok(result.success);
    assert.strictEqual(result.data!.xpReward, 50);
  });

  it("allows custom xpReward", () => {
    const result = academyCompleteSchema.safeParse({
      lessonId: "lesson-2",
      xpReward: "100",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.xpReward, 100);
  });

  it("rejects empty lessonId", () => {
    const result = academyCompleteSchema.safeParse({ lessonId: "" });
    assert.ok(!result.success);
  });
});
