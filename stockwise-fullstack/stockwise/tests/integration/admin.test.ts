import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Admin APIs", () => {
  let adminState: any;
  let adminReq: any;
  let adminId: number;
  let userState: any;
  let userReq: any;
  let verifyTargetId: number;
  let roleTargetId: number;
  let prisma: any;

  before(async () => {
    await startServer();
    const { PrismaClient } = await import("@prisma/client");
    prisma = new PrismaClient();

    // Create an admin user via API (needed for session)
    adminState = { sessionCookie: "", csrfToken: "" };
    adminReq = makeReq(adminState);
    const id = uid();
    await adminReq("POST", "/api/register", {
      username: `admin_${id}`,
      email: `admin_${id}@test.com`,
      password: "AdminPass99!",
    });
    await adminReq("POST", "/api/login", {
      email: `admin_${id}@test.com`,
      password: "AdminPass99!",
    });
    const { data: me } = await adminReq("GET", "/api/me");
    adminId = me.userId || me.id;
    await prisma.user.update({ where: { id: adminId }, data: { role: "admin" } });

    // Create a plain user via API
    userState = { sessionCookie: "", csrfToken: "" };
    userReq = makeReq(userState);
    const uid2 = uid();
    await userReq("POST", "/api/register", {
      username: `plain_${uid2}`,
      email: `plain_${uid2}@test.com`,
      password: "PlainPass99!",
    });
    await userReq("POST", "/api/login", {
      email: `plain_${uid2}@test.com`,
      password: "PlainPass99!",
    });

    // Pre-create target users via Prisma (avoids rate limits)
    const verifyUser = await prisma.user.create({
      data: { username: `verifytarget_${uid()}`, email: `verifytarget_${uid()}@test.com`, password: "x" },
    });
    verifyTargetId = verifyUser.id;

    const roleUser = await prisma.user.create({
      data: { username: `roletarget_${uid()}`, email: `roletarget_${uid()}@test.com`, password: "x" },
    });
    roleTargetId = roleUser.id;

    // Create a moderator user — use separate state so admin session isn't overwritten
    const modCreds = { username: `mod_${uid()}`, email: `mod_${uid()}@test.com`, password: "Mod99_Test" };
    const tempState = { sessionCookie: "", csrfToken: "" };
    const tempReq = makeReq(tempState);
    await tempReq("POST", "/api/register", modCreds);
    await tempReq("POST", "/api/login", { email: modCreds.email, password: modCreds.password });
    const { data: modMe } = await tempReq("GET", "/api/me");
    const modId = modMe.userId || modMe.id;
    await prisma.user.update({ where: { id: modId }, data: { role: "moderator" } });
    modState = tempState;
    modReq = tempReq;
  });

  after(async () => {
    if (prisma) await prisma.$disconnect();
    await stopServer();
  });

  let modState: any;
  let modReq: any;

  // ─── AUTH GUARDS ──────────────────────────────────────────────

  describe("Auth guards", () => {
    it("GET /admin/stats should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/stats");
      assert.strictEqual(status, 401);
    });

    it("GET /admin/users should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/users");
      assert.strictEqual(status, 401);
    });

    it("GET /admin/users/:id should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/users/1");
      assert.strictEqual(status, 401);
    });

    it("GET /admin/activity should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/activity");
      assert.strictEqual(status, 401);
    });

    it("GET /admin/posts should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/posts");
      assert.strictEqual(status, 401);
    });

    it("GET /admin/reset-requests should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/reset-requests");
      assert.strictEqual(status, 401);
    });

    it("POST /admin/set-role should reject unauthenticated (CSRF)", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/admin/set-role", {});
      assert.strictEqual(status, 403);
    });

    it("POST /admin/verify-user should reject unauthenticated (CSRF)", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/admin/verify-user", {});
      assert.strictEqual(status, 403);
    });

    it("POST /admin/delete-user should reject unauthenticated (CSRF)", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/admin/delete-user", {});
      assert.strictEqual(status, 403);
    });

    it("DELETE /admin/posts/:id should reject unauthenticated (CSRF)", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", "/api/admin/posts/1");
      assert.strictEqual(status, 403);
    });

    it("should reject non-admin user for admin endpoints", async () => {
      const { status } = await userReq("GET", "/api/admin/stats");
      assert.strictEqual(status, 403);
    });
  });

  // ─── DASHBOARD ────────────────────────────────────────────────

  describe("GET /admin/stats (dashboard)", () => {
    it("should return dashboard stats for admin", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/stats");
      assert.strictEqual(status, 200);
      assert.strictEqual(typeof data.totalUsers, "number");
      assert.strictEqual(typeof data.totalPosts, "number");
      assert.strictEqual(typeof data.totalGroups, "number");
      assert.strictEqual(typeof data.totalAlerts, "number");
      assert.strictEqual(typeof data.totalPortfolios, "number");
      assert.strictEqual(typeof data.pendingVerifications, "number");
      assert.strictEqual(typeof data.pendingResets, "number");
      assert.strictEqual(typeof data.activeToday, "number");
      assert.ok(Array.isArray(data.recentLogins));
    });
  });

  // ─── USERS ────────────────────────────────────────────────────

  describe("GET /admin/users", () => {
    it("should return paginated user list", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/users");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.users));
      assert.strictEqual(typeof data.total, "number");
      assert.strictEqual(typeof data.page, "number");
      assert.strictEqual(typeof data.limit, "number");
      assert.strictEqual(typeof data.totalPages, "number");
      assert.ok(data.users.length > 0);
    });

    it("should support pagination via page param", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/users?page=1&limit=5");
      assert.strictEqual(status, 200);
      assert.ok(data.users.length <= 5);
    });

    it("should search users by username", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/users?q=admin_");
      assert.strictEqual(status, 200);
      assert.ok(data.users.length > 0);
      assert.ok(data.users.every((u: any) => u.username.includes("admin_")));
    });

    it("should filter users by role", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/users?role=admin");
      assert.strictEqual(status, 200);
      assert.ok(data.users.length > 0);
      assert.ok(data.users.every((u: any) => u.role === "admin"));
    });

    it("should include counts in user list", async () => {
      const { data } = await adminReq("GET", "/api/admin/users?limit=1");
      const user = data.users[0];
      assert.ok(user._count !== undefined);
      assert.strictEqual(typeof user._count.posts, "number");
    });
  });

  describe("GET /admin/users/:id", () => {
    it("should return user details", async () => {
      const { status, data } = await adminReq("GET", `/api/admin/users/${adminId}`);
      assert.strictEqual(status, 200);
      assert.strictEqual(typeof data.id, "number");
      assert.strictEqual(typeof data.username, "string");
      assert.strictEqual(typeof data.email, "string");
      assert.strictEqual(typeof data.role, "string");
      assert.ok(Array.isArray(data.holdings));
      assert.ok(Array.isArray(data.recentPosts));
      assert.ok(Array.isArray(data.recentLogins));
      assert.ok(data._count !== undefined);
    });

    it("should return 404 for non-existent user", async () => {
      const { status } = await adminReq("GET", "/api/admin/users/9999999");
      assert.strictEqual(status, 404);
    });
  });

  // ─── ROLE MANAGEMENT ──────────────────────────────────────────

  describe("POST /admin/set-role", () => {
    it("should change user role", async () => {
      const { status } = await adminReq("POST", "/api/admin/set-role", {
        userId: roleTargetId,
        role: "moderator",
      });
      assert.strictEqual(status, 200);
    });

    it("should reject invalid role value", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/set-role", {
        userId: adminId,
        role: "god",
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should return 404 for non-existent user", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/set-role", {
        userId: 9999999,
        role: "user",
      });
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });
  });

  // ─── VERIFICATION ─────────────────────────────────────────────

  describe("POST /admin/verify-user", () => {
    it("should toggle verification status", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/verify-user", {
        userId: verifyTargetId,
      });
      assert.strictEqual(status, 200);
      assert.strictEqual(typeof data.is_verified, "number");
    });

    it("should return 404 for non-existent user", async () => {
      const { status } = await adminReq("POST", "/api/admin/verify-user", {
        userId: 9999999,
      });
      assert.strictEqual(status, 404);
    });
  });

  // ─── ACTIVITY ─────────────────────────────────────────────────

  describe("GET /admin/activity", () => {
    it("should return paginated activity log", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/activity");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.logs));
      assert.strictEqual(typeof data.total, "number");
      assert.strictEqual(typeof data.page, "number");
    });
  });

  // ─── PASSWORD RESETS ──────────────────────────────────────────

  describe("GET /admin/reset-requests", () => {
    it("should return reset requests array", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/reset-requests");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  // ─── GENERATE RESET TOKEN ─────────────────────────────────────

  describe("POST /admin/generate-reset-token", () => {
    let targetId: number;
    let targetUsername: string;
    let targetEmail: string;

    before(async () => {
      const user = await prisma.user.create({
        data: { username: `gentoken_${uid()}`, email: `gentoken_${uid()}@test.com`, password: "x" },
      });
      targetId = user.id;
      targetUsername = user.username;
      targetEmail = user.email;
    });

    it("should reject unauthenticated (CSRF)", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/admin/generate-reset-token", { identifier: "1" });
      assert.strictEqual(status, 403);
    });

    it("should reject missing identifier", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/generate-reset-token", {});
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should return 404 for non-existent user", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/generate-reset-token", { identifier: "9999999" });
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });

    it("should generate a reset token by ID", async () => {
      const { status, data } = await adminReq("POST", "/api/admin/generate-reset-token", { identifier: String(targetId) });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
      assert.strictEqual(data.userId, targetId);
      assert.strictEqual(data.username, targetUsername);
      assert.strictEqual(data.email, targetEmail);
      assert.strictEqual(typeof data.token, "string");
      assert.ok(data.token.length > 0);
      assert.strictEqual(typeof data.expires, "number");
    });

    it("should generate a reset token by email", async () => {
      const { data: gen } = await adminReq("POST", "/api/admin/generate-reset-token", { identifier: targetEmail });
      assert.ok(gen.success);
      assert.strictEqual(gen.userId, targetId);
    });

    it("should generate a reset token by username", async () => {
      const { data: gen } = await adminReq("POST", "/api/admin/generate-reset-token", { identifier: targetUsername });
      assert.ok(gen.success);
      assert.strictEqual(gen.userId, targetId);
    });

    it("should produce a valid token usable in reset-password", async () => {
      const { data: gen } = await adminReq("POST", "/api/admin/generate-reset-token", { identifier: String(targetId) });
      // Use the token to reset the password
      const { status, data } = await makeReq({})("POST", "/api/reset-password", {
        token: gen.token,
        password: "NewPass123!",
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should deny moderator access", async () => {
      const { status } = await modReq("POST", "/api/admin/generate-reset-token", { identifier: String(targetId) });
      assert.strictEqual(status, 403);
    });
  });

  // ─── LOGS ANALYSIS ────────────────────────────────────────────

  describe("GET /admin/logs", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/admin/logs");
      assert.strictEqual(status, 401);
    });

    it("should return log analysis for admin", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/logs");
      assert.strictEqual(status, 200);
      assert.ok(data.summary);
      assert.strictEqual(typeof data.summary.totalRequests, "number");
      assert.strictEqual(typeof data.summary.totalErrors, "number");
      assert.strictEqual(typeof data.summary.avgDuration, "number");
      assert.strictEqual(typeof data.summary.errorRate, "number");
      assert.strictEqual(typeof data.summary.requestsLastHour, "number");
      assert.ok(data.summary.statusBreakdown);
      assert.ok(Array.isArray(data.summary.topPaths));
      assert.ok(Array.isArray(data.summary.requestsByHour));
      assert.ok(Array.isArray(data.recentRequests));
      assert.ok(Array.isArray(data.recentErrors));
      assert.ok(Array.isArray(data.events));
    });

    it("should allow moderator access", async () => {
      const { status } = await modReq("GET", "/api/admin/logs");
      assert.strictEqual(status, 200);
    });
  });

  // ─── POSTS MODERATION ─────────────────────────────────────────

  describe("POST /admin/posts", () => {
    let postId: number;

    before(async () => {
      await adminReq("POST", "/api/community", { content: `Post to moderate ${uid()}` });
      const { data } = await adminReq("GET", "/api/admin/posts?limit=1");
      postId = data.posts?.[0]?.id;
    });

    it("GET /admin/posts should return paginated post list", async () => {
      const { status, data } = await adminReq("GET", "/api/admin/posts");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.posts));
      assert.strictEqual(typeof data.total, "number");
      assert.strictEqual(typeof data.page, "number");
      assert.strictEqual(typeof data.limit, "number");
      assert.strictEqual(typeof data.totalPages, "number");
    });

    it("DELETE /admin/posts/:id should delete a post", async () => {
      if (!postId) return;
      const { status } = await adminReq("DELETE", `/api/admin/posts/${postId}`);
      assert.strictEqual(status, 200);
    });

    it("DELETE /admin/posts/:id should return 404 for non-existent post", async () => {
      const { status } = await adminReq("DELETE", "/api/admin/posts/9999999");
      assert.strictEqual(status, 404);
    });
  });

  // ─── USER DELETION ────────────────────────────────────────────

  describe("POST /admin/delete-user", () => {
    it("should delete a non-admin user", async () => {
      const user = await prisma.user.create({
        data: { username: `delete_${uid()}`, email: `delete_${uid()}@test.com`, password: "x" },
      });
      const { status, data } = await adminReq("POST", "/api/admin/delete-user", {
        userId: user.id,
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should return 404 for non-existent user", async () => {
      const { status } = await adminReq("POST", "/api/admin/delete-user", {
        userId: 9999999,
      });
      assert.strictEqual(status, 404);
    });

    it("should reject self-deletion", async () => {
      const { status } = await adminReq("POST", "/api/admin/delete-user", {
        userId: adminId,
      });
      assert.strictEqual(status, 400);
    });
  });

  // ─── ACCESS CONTROL ──────────────────────────────────────────

  describe("Moderator access", () => {
    it("should allow moderator to view users", async () => {
      const { status } = await modReq("GET", "/api/admin/users");
      assert.strictEqual(status, 200);
    });

    it("should allow moderator to view activity", async () => {
      const { status } = await modReq("GET", "/api/admin/activity");
      assert.strictEqual(status, 200);
    });

    it("should allow moderator to view posts", async () => {
      const { status } = await modReq("GET", "/api/admin/posts");
      assert.strictEqual(status, 200);
    });

    it("should allow moderator to delete a post", async () => {
      await adminReq("POST", "/api/community", { content: `Mod moderate test ${uid()}` });
      const { data } = await modReq("GET", "/api/admin/posts?limit=1");
      const pid = data.posts?.[0]?.id;
      if (!pid) return;
      const { status } = await modReq("DELETE", `/api/admin/posts/${pid}`);
      assert.strictEqual(status, 200);
    });

    it("should deny moderator from dashboard stats (admin-only)", async () => {
      const { status } = await modReq("GET", "/api/admin/stats");
      assert.strictEqual(status, 403);
    });

    it("should deny moderator from setting roles", async () => {
      const { status } = await modReq("POST", "/api/admin/set-role", { userId: 1, role: "user" });
      assert.strictEqual(status, 403);
    });

    it("should deny moderator from verify-user", async () => {
      const { status } = await modReq("POST", "/api/admin/verify-user", { userId: 1 });
      assert.strictEqual(status, 403);
    });

    it("should deny moderator from delete-user", async () => {
      const { status } = await modReq("POST", "/api/admin/delete-user", { userId: 1 });
      assert.strictEqual(status, 403);
    });

    it("should deny moderator from reset-requests", async () => {
      const { status } = await modReq("GET", "/api/admin/reset-requests");
      assert.strictEqual(status, 403);
    });
  });
});
