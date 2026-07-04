import { describe, it, before, after } from "node:test";
import assert from "node:assert";

let mod: any;

before(async () => {
  mod = await import("../middleware/errors.js");
});

describe("AppError", () => {
  it("creates error with default status 500", () => {
    const err = new mod.AppError("test error");
    assert.strictEqual(err.message, "test error");
    assert.strictEqual(err.statusCode, 500);
    assert.strictEqual(err.name, "AppError");
  });

  it("creates error with custom status and details", () => {
    const err = new mod.AppError("not found", 404, { field: "id" });
    assert.strictEqual(err.statusCode, 404);
    assert.deepStrictEqual(err.details, { field: "id" });
  });
});

describe("errorHandler", () => {
  it("returns 500 for falsy error", () => {
    const json = [];
    mod.errorHandler(null, { path: "/test" }, { status: () => ({ json: (v: any) => json.push(v) }) }, null);
    assert.strictEqual(json[0].error, "Internal server error");
  });

  it("returns error message for client errors", () => {
    const json = [];
    const err = new mod.AppError("Bad request", 400);
    mod.errorHandler(err, { path: "/test" }, { status: () => ({ json: (v: any) => json.push(v) }) }, null);
    assert.strictEqual(json[0].error, "Bad request");
  });

  it("masks details for 500 errors", () => {
    const json = [];
    const err = new mod.AppError("db connection failed", 500, { query: "SELECT *" });
    mod.errorHandler(err, { path: "/test" }, { status: () => ({ json: (v: any) => json.push(v) }) }, null);
    assert.strictEqual(json[0].error, "Internal server error");
    assert.strictEqual(json[0].details, undefined);
  });

  it("includes details for client errors", () => {
    const json = [];
    const err = new mod.AppError("Validation failed", 422, { field: "email" });
    mod.errorHandler(err, { path: "/test" }, { status: () => ({ json: (v: any) => json.push(v) }) }, null);
    assert.strictEqual(json[0].error, "Validation failed");
    assert.deepStrictEqual(json[0].details, { field: "email" });
  });
});

describe("wrapAsync", () => {
  it("catches async rejections and passes to next", async () => {
    const fn = async () => { throw new Error("async fail"); };
    const next: any[] = [];
    await mod.wrapAsync(fn)(null, null, (v: any) => next.push(v));
    assert.strictEqual(next[0].message, "async fail");
  });

  it("passes through on success", async () => {
    let called = false;
    const fn = async () => { called = true; };
    const next: any[] = [];
    await mod.wrapAsync(fn)(null, null, (v: any) => next.push(v));
    assert.ok(called);
    assert.strictEqual(next.length, 0);
  });
});
