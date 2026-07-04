import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Auth APIs", () => {
  before(async () => {
    await startServer();
  });

  after(async () => {
    await stopServer();
  });

  describe("POST /api/register", () => {
    it("should register a new user", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      const { status, data } = await req("POST", "/api/register", {
        username: `reg_${id}`,
        email: `reg_${id}@test.com`,
        password: "TestPass99!",
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should reject duplicate email", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      const email = `dup_${id}@test.com`;
      await req("POST", "/api/register", {
        username: `dup1_${id}`,
        email,
        password: "TestPass99!",
      });
      const { status } = await req("POST", "/api/register", {
        username: `dup2_${id}`,
        email,
        password: "TestPass99!",
      });
      assert.strictEqual(status, 400);
    });

    it("should reject short password", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const { status } = await req("POST", "/api/register", {
        username: "badpw",
        email: "badpw@test.com",
        password: "ab",
      });
      assert.strictEqual(status, 400);
    });
  });

  describe("POST /api/login", () => {
    it("should login with valid credentials", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `login_${id}`,
        email: `login_${id}@test.com`,
        password: "LoginPass99!",
      });
      const { status, data } = await req("POST", "/api/login", {
        email: `login_${id}@test.com`,
        password: "LoginPass99!",
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(data.loggedIn, true);
    });

    it("should reject invalid password", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `badpw_${id}`,
        email: `badpw_${id}@test.com`,
        password: "LoginPass99!",
      });
      const { status } = await req("POST", "/api/login", {
        email: `badpw_${id}@test.com`,
        password: "wrongpassword",
      });
      assert.strictEqual(status, 400);
    });
  });

  describe("GET /api/me", () => {
    it("should return loggedIn:false for anonymous", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/me");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.loggedIn, false);
    });

    it("should return user data for authenticated user", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `me_${id}`,
        email: `me_${id}@test.com`,
        password: "MePass99!",
      });
      await req("POST", "/api/login", {
        email: `me_${id}@test.com`,
        password: "MePass99!",
      });
      const { status, data } = await req("GET", "/api/me");
      assert.strictEqual(status, 200);
      assert.strictEqual(data.loggedIn, true);
      assert.ok(data.id);
      assert.ok(data.username);
      assert.ok(data.email);
    });
  });

  describe("POST /api/profile", () => {
    it("should update user profile", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `prof_${id}`,
        email: `prof_${id}@test.com`,
        password: "ProfPass99!",
      });
      await req("POST", "/api/login", {
        email: `prof_${id}@test.com`,
        password: "ProfPass99!",
      });
      const { status, data } = await req("POST", "/api/profile", {
        username: `updated_${id}`,
        email: `updated_${id}@test.com`,
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/profile", {
        username: "nobody",
        email: "nobody@test.com",
      });
      assert.strictEqual(status, 403);
    });
  });

  describe("POST /api/forgot-password", () => {
    it("should return success for registered email", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `fp_${id}`,
        email: `fp_${id}@test.com`,
        password: "FpPass99!",
      });
      await req("POST", "/api/login", {
        email: `fp_${id}@test.com`,
        password: "FpPass99!",
      });
      const { status, data } = await req("POST", "/api/forgot-password", {
        email: `fp_${id}@test.com`,
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("POST /api/logout", () => {
    it("should logout authenticated user", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const id = uid();
      await req("POST", "/api/register", {
        username: `lo_${id}`,
        email: `lo_${id}@test.com`,
        password: "LoPass99!",
      });
      await req("POST", "/api/login", {
        email: `lo_${id}@test.com`,
        password: "LoPass99!",
      });
      const { status, data } = await req("POST", "/api/logout");
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("POST /api/reset-password", () => {
    it("should reject invalid token", async () => {
      const state = { sessionCookie: "", csrfToken: "" };
      const req = makeReq(state);
      const { status } = await req("POST", "/api/reset-password", {
        token: "invalid-token",
        password: "NewPass99!",
      });
      assert.strictEqual(status, 400);
    });
  });
});
