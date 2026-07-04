import { describe, it, before } from "node:test";
import assert from "node:assert";
import crypto from "crypto";

describe("csrf middleware", () => {
  let initCsrfToken: (req: any, res: any, next: any) => void;
  let csrfProtection: (req: any, res: any, next: any) => void;

  before(async () => {
    const mod = await import("../../middleware/csrf.js");
    initCsrfToken = mod.initCsrfToken;
    csrfProtection = mod.csrfProtection;
  });

  describe("initCsrfToken", () => {
    it("should set a csrfToken on session if missing", () => {
      const req: any = { session: {} };
      const res: any = {};
      let called = false;
      initCsrfToken(req, res, () => { called = true; });
      assert.ok(called);
      assert.ok(req.session.csrfToken);
      assert.strictEqual(typeof req.session.csrfToken, "string");
      assert.strictEqual(req.session.csrfToken.length, 64);
    });

    it("should not overwrite existing csrfToken", () => {
      const existing = crypto.randomBytes(32).toString("hex");
      const req: any = { session: { csrfToken: existing } };
      const res: any = {};
      initCsrfToken(req, res, () => {});
      assert.strictEqual(req.session.csrfToken, existing);
    });
  });

  describe("csrfProtection", () => {
    it("should allow GET requests through", () => {
      const req: any = { method: "GET", path: "/api/some-data", session: { csrfToken: "token" } };
      const res: any = {};
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      assert.ok(called);
    });

    it("should allow HEAD requests through", () => {
      const req: any = { method: "HEAD", path: "/api/some-data", session: { csrfToken: "token" } };
      const res: any = {};
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      assert.ok(called);
    });

    it("should allow OPTIONS requests through", () => {
      const req: any = { method: "OPTIONS", path: "/api/some-data", session: { csrfToken: "token" } };
      const res: any = {};
      let called = false;
      csrfProtection(req, res, () => { called = true; });
      assert.ok(called);
    });

    it("should allow exempt paths without CSRF token", () => {
      const exemptPaths = ["/api/login", "/api/register", "/api/forgot-password", "/api/reset-password", "/api/logout"];
      for (const path of exemptPaths) {
        const req: any = { method: "POST", path, session: {} };
        const res: any = {};
        let called = false;
        csrfProtection(req, res, () => { called = true; });
        assert.ok(called, `should allow ${path}`);
      }
    });

    it("should reject POST with no session CSRF token", () => {
      const req: any = { method: "POST", path: "/api/profile", session: {} };
      let statusCode = 0;
      let jsonData: any = null;
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      csrfProtection(req, res, () => {});
      assert.strictEqual(statusCode, 403);
      assert.ok(jsonData.error.includes("No CSRF token"));
    });

    it("should reject POST with missing x-csrf-token header", () => {
      const req: any = { method: "POST", path: "/api/profile", session: { csrfToken: "valid-token" }, headers: {} };
      let statusCode = 0;
      let jsonData: any = null;
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      csrfProtection(req, res, () => {});
      assert.strictEqual(statusCode, 403);
      assert.ok(jsonData.error.includes("Invalid or missing"));
    });

    it("should reject POST with mismatched CSRF token", () => {
      const req: any = {
        method: "POST",
        path: "/api/profile",
        session: { csrfToken: "valid-token-here" },
        headers: { "x-csrf-token": "wrong-token" },
      };
      let statusCode = 0;
      let jsonData: any = null;
      const res: any = {
        status: (code: number) => { statusCode = code; return res; },
        json: (data: any) => { jsonData = data; },
      };
      csrfProtection(req, res, () => {});
      assert.strictEqual(statusCode, 403);
    });

    it("should pass POST with valid CSRF token", () => {
      const token = crypto.randomBytes(32).toString("hex");
      const req: any = {
        method: "POST",
        path: "/api/profile",
        session: { csrfToken: token },
        headers: { "x-csrf-token": token },
      };
      let called = false;
      const res: any = { status: () => res, json: () => {} };
      csrfProtection(req, res, () => { called = true; });
      assert.ok(called);
    });
  });
});
