import { describe, it } from "node:test";
import assert from "node:assert";
import { trainSchema } from "../../schemas/ml.js";
import { buildScheduledRetrainPayload } from "../../services/mlRetraining.js";

describe("trainSchema", () => {
  it("uses defaults when empty body provided", () => {
    const result = trainSchema.safeParse({});
    assert.ok(result.success);
    assert.strictEqual(result.data!.model, "gbm");
    assert.strictEqual(result.data!.days, 90);
    assert.strictEqual(result.data!.horizon, 4);
    assert.strictEqual(result.data!.lookback, 60);
    assert.strictEqual(result.data!.threshold, 0.5);
    assert.strictEqual(result.data!.min_samples, 5000);
  });

  it("accepts all valid models", () => {
    for (const model of ["gbm", "lstm", "ppo", "all"] as const) {
      const result = trainSchema.safeParse({ model });
      assert.ok(result.success, `model "${model}" should be valid`);
    }
  });

  it("rejects invalid model", () => {
    const result = trainSchema.safeParse({ model: "svm" });
    assert.ok(!result.success);
  });

  it("validates days range (15-365)", () => {
    const tooLow = trainSchema.safeParse({ days: 10 });
    assert.ok(!tooLow.success);
    const tooHigh = trainSchema.safeParse({ days: 400 });
    assert.ok(!tooHigh.success);
  });

  it("validates horizon range (1-24)", () => {
    const tooLow = trainSchema.safeParse({ horizon: 0 });
    assert.ok(!tooLow.success);
    const tooHigh = trainSchema.safeParse({ horizon: 25 });
    assert.ok(!tooHigh.success);
  });

  it("validates min_samples range (100-50000)", () => {
    const tooLow = trainSchema.safeParse({ min_samples: 50 });
    assert.ok(!tooLow.success);
    const tooHigh = trainSchema.safeParse({ min_samples: 60000 });
    assert.ok(!tooHigh.success);
  });

  it("builds a stable scheduled retraining payload", () => {
    const payload = buildScheduledRetrainPayload();
    assert.deepStrictEqual(payload, {
      model: "gbm",
      days: 90,
      horizon: 4,
      lookback: 60,
      threshold: 0.5,
      min_samples: 5000,
    });
  });
});
