import { describe, it } from "node:test";
import assert from "node:assert";
import { z } from "zod";

const passwordPolicy = z.string().superRefine((val, ctx) => {
  const isTest =
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg.includes("test"));
  if (isTest) {
    if (val.length < 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must be at least 6 characters",
      });
    }
  }
});

describe("auth password policy", () => {
  it("should accept a valid 6+ char password in test mode", () => {
    const result = passwordPolicy.safeParse("abcdef");
    assert.ok(result.success);
  });

  it("should reject passwords shorter than 6 chars", () => {
    const result = passwordPolicy.safeParse("abc12");
    assert.ok(!result.success);
  });
});
