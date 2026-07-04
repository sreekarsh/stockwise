import { describe, it } from "node:test";
import assert from "node:assert";
import { alertCreateSchema, webhookSchema } from "../../schemas/alerts.js";

describe("alertCreateSchema", () => {
  it("accepts valid alert with number price", () => {
    const result = alertCreateSchema.safeParse({
      symbol: "BTC",
      target_price: 50000,
      direction: "above",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.target_price, 50000);
  });

  it("accepts valid alert with string price (transforms to number)", () => {
    const result = alertCreateSchema.safeParse({
      symbol: "ETH",
      target_price: "3000",
      direction: "below",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.target_price, 3000);
  });

  it("rejects empty symbol", () => {
    const result = alertCreateSchema.safeParse({
      symbol: "",
      target_price: 100,
      direction: "above",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid direction", () => {
    const result = alertCreateSchema.safeParse({
      symbol: "BTC",
      target_price: 100,
      direction: "sideways",
    });
    assert.ok(!result.success);
  });
});

describe("webhookSchema", () => {
  it("accepts valid webhook payload", () => {
    const result = webhookSchema.safeParse({
      passphrase: "secret",
      symbol: "BTCUSDT",
      action: "BUY",
      price: 45000,
    });
    assert.ok(result.success);
  });

  it("provides default msg when omitted", () => {
    const result = webhookSchema.safeParse({
      passphrase: "secret",
      symbol: "ETHUSDT",
      action: "SELL",
      price: "3000",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.msg, "");
  });
});
