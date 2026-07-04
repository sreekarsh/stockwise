import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, loginUser } from "../helpers.js";

describe("ML Signals APIs", () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    await stopServer();
  });

  describe("GET /api/ml/health", () => {
    it("should return health status (200 or 502 depending on ML readiness)", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/ml/health");
      assert.ok([200, 502].includes(status));
      if (status === 200) {
        assert.ok(data.status);
        assert.ok(data.model_version);
      }
    });
  });

  describe("GET /api/ml/training-status", () => {
    it("should return training status", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/ml/training-status");
      assert.strictEqual(status, 200);
      assert.ok(data !== undefined);
    });
  });

  describe("GET /api/ml/performance", () => {
    it("should return performance data", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/ml/performance");
      assert.strictEqual(status, 200);
      assert.ok(data !== undefined);
    });
  });

  describe("POST /api/ml/train (auth required)", () => {
    async function authedReq() {
      const state = { sessionCookie: "", csrfToken: "" };
      await loginUser(state);
      return makeReq(state);
    }

    it("should reject unauthenticated requests", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/ml/train", { model: "gbm" });
      assert.strictEqual(status, 403);
    });

    it("should reject unsupported model name", async () => {
      const req = await authedReq();
      const { status, data } = await req("POST", "/api/ml/train", { model: "invalid" });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should reject threshold out of range", async () => {
      const req = await authedReq();
      const { status, data } = await req("POST", "/api/ml/train", { model: "gbm", threshold: 999 });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should reject days out of range", async () => {
      const req = await authedReq();
      const { status, data } = await req("POST", "/api/ml/train", { model: "gbm", days: 999 });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });
});
