import { describe, it, before } from "node:test";
import assert from "node:assert";

// Simulate non-test environment to exercise full password policy
const ORIG_ARGV = process.argv;
before(() => {
  process.argv = ["node", "server.js"];
  process.env.NODE_ENV = "development";
});

describe("passwordPolicy (non-test mode)", () => {
  it("rejects password shorter than 8 chars", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("Abc1!x");
    assert.ok(!r.success);
  });

  it("rejects password missing uppercase", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("abcdefgh1!");
    assert.ok(!r.success);
  });

  it("rejects password missing lowercase", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("ABCDEFGH1!");
    assert.ok(!r.success);
  });

  it("rejects password missing number", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("Abcdefgh!");
    assert.ok(!r.success);
  });

  it("rejects password missing special char", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("Abcdefgh1");
    assert.ok(!r.success);
  });

  it("accepts fully valid password", async () => {
    const { passwordPolicy } = await import("../schemas/auth.js");
    const r = passwordPolicy.safeParse("Abcd1234!");
    assert.ok(r.success);
  });
});
