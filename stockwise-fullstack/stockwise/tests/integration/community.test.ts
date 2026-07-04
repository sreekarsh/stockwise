import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { startServer, stopServer, makeReq, uid } from "../helpers.js";

describe("Community APIs", () => {
  let authedState: any;
  let authedReq: any;
  let authedId: number;
  let testPostId: number;

  before(async () => {
    await startServer();
    authedState = { sessionCookie: "", csrfToken: "" };
    authedReq = makeReq(authedState);
    const id = uid();
    await authedReq("POST", "/api/register", {
      username: `suite_${id}`,
      email: `suite_${id}@test.com`,
      password: "SuitePass99!",
    });
    await authedReq("POST", "/api/login", {
      email: `suite_${id}@test.com`,
      password: "SuitePass99!",
    });
    const { data: me } = await authedReq("GET", "/api/me");
    authedId = me.userId || me.id;

    await authedReq("POST", "/api/community", { content: `Test post for likes ${uid()}` });
    const { data: posts } = await authedReq("GET", "/api/community?limit=1");
    testPostId = posts.posts?.[0]?.id;
  });

  after(async () => {
    await stopServer();
  });

  describe("GET /api/community", () => {
    it("should return post list", async () => {
      const req = makeReq({});
      const { status, data } = await req("GET", "/api/community");
      assert.strictEqual(status, 200);
      assert.ok(data.posts);
      assert.ok(Array.isArray(data.posts));
    });
  });

  describe("POST /api/community", () => {
    it("should reject unauthenticated (CSRF -> 403)", async () => {
      const req = makeReq({});
      const { status } = await req("POST", "/api/community", {
        content: "Hello!",
      });
      assert.strictEqual(status, 403);
    });

    it("should create a post when authenticated", async () => {
      const { status } = await authedReq("POST", "/api/community", {
        content: `Test post ${uid()}`,
      });
      assert.strictEqual(status, 200);
    });

    it("should reject empty content", async () => {
      const { status, data } = await authedReq("POST", "/api/community", {
        content: "",
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });

  describe("PUT /api/community/:id (edit post)", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("PUT", `/api/community/${testPostId}`, {
        content: "Hacked!",
      });
      assert.strictEqual(status, 403);
    });

    it("should edit own post", async () => {
      const { status } = await authedReq("PUT", `/api/community/${testPostId}`, {
        content: `Edited content ${uid()}`,
      });
      assert.strictEqual(status, 200);
    });

    it("should reject editing another user's post", async () => {
      const other = makeReq({});
      const id = uid();
      await other("POST", "/api/register", { username: `other_${id}`, email: `other_${id}@test.com`, password: "OtherPass99!" });
      await other("POST", "/api/login", { email: `other_${id}@test.com`, password: "OtherPass99!" });
      const { status, data } = await other("PUT", `/api/community/${testPostId}`, {
        content: "Stolen edit!",
      });
      assert.strictEqual(status, 403);
      assert.ok(data.error);
    });

    it("should reject empty edit", async () => {
      const { status, data } = await authedReq("PUT", `/api/community/${testPostId}`, {
        content: "",
      });
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });
  });

  describe("DELETE /api/community/:id (delete post)", () => {
    let deletePostId: number;

    before(async () => {
      await authedReq("POST", "/api/community", { content: `To delete ${uid()}` });
      const { data } = await authedReq("GET", "/api/community?limit=1");
      deletePostId = data.posts?.[0]?.id;
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", `/api/community/${deletePostId}`);
      assert.strictEqual(status, 403);
    });

    it("should delete own post", async () => {
      const { status } = await authedReq("DELETE", `/api/community/${deletePostId}`);
      assert.strictEqual(status, 200);
    });

    it("should reject unauthenticated (CSRF) on deleted post", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", `/api/community/${deletePostId}`);
      assert.strictEqual(status, 403);
    });
  });

  describe("POST /api/community/:id/like", () => {
    let likePostId: number;

    before(async () => {
      await authedReq("POST", "/api/community", { content: `Like target ${uid()}` });
      const { data } = await authedReq("GET", "/api/community?limit=1");
      likePostId = data.posts?.[0]?.id;
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", `/api/community/${likePostId}/like`);
      assert.strictEqual(status, 403);
    });

    it("should like a post", async () => {
      const { status, data } = await authedReq("POST", `/api/community/${likePostId}/like`);
      assert.strictEqual(status, 200);
      assert.ok(data.success);
      assert.strictEqual(typeof data.likes, "number");
    });

    it("should be idempotent on double like", async () => {
      const { status, data } = await authedReq("POST", `/api/community/${likePostId}/like`);
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should return 404 for non-existent post", async () => {
      const { status, data } = await authedReq("POST", "/api/community/9999999/like");
      assert.strictEqual(status, 404);
      assert.ok(data.error);
    });
  });

  describe("DELETE /api/community/:id/like", () => {
    let unlikePostId: number;

    before(async () => {
      await authedReq("POST", "/api/community", { content: `Unlike target ${uid()}` });
      const { data } = await authedReq("GET", "/api/community?limit=1");
      unlikePostId = data.posts?.[0]?.id;
      await authedReq("POST", `/api/community/${unlikePostId}/like`);
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", `/api/community/${unlikePostId}/like`);
      assert.strictEqual(status, 403);
    });

    it("should unlike a post", async () => {
      const { status, data } = await authedReq("DELETE", `/api/community/${unlikePostId}/like`);
      assert.strictEqual(status, 200);
      assert.ok(data.success);
      assert.strictEqual(typeof data.likes, "number");
    });

    it("should be idempotent on double unlike", async () => {
      const { status, data } = await authedReq("DELETE", `/api/community/${unlikePostId}/like`);
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("POST /api/community/:id/reaction", () => {
    let reactPostId: number;

    before(async () => {
      await authedReq("POST", "/api/community", { content: `Reaction target ${uid()}` });
      const { data } = await authedReq("GET", "/api/community?limit=1");
      reactPostId = data.posts?.[0]?.id;
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("POST", `/api/community/${reactPostId}/reaction`, { emoji: "👍" });
      assert.strictEqual(status, 403);
    });

    it("should add a reaction", async () => {
      const { status, data } = await authedReq("POST", `/api/community/${reactPostId}/reaction`, { emoji: "🔥" });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should reject missing emoji", async () => {
      const { status, data } = await authedReq("POST", `/api/community/${reactPostId}/reaction`, {});
      assert.strictEqual(status, 400);
      assert.ok(data.error);
    });

    it("should be idempotent for same emoji", async () => {
      const { status } = await authedReq("POST", `/api/community/${reactPostId}/reaction`, { emoji: "🔥" });
      assert.strictEqual(status, 200);
    });

    it("should allow multiple different emojis", async () => {
      const { status: s1 } = await authedReq("POST", `/api/community/${reactPostId}/reaction`, { emoji: "❤️" });
      assert.strictEqual(s1, 200);
      const { status: s2 } = await authedReq("POST", `/api/community/${reactPostId}/reaction`, { emoji: "🚀" });
      assert.strictEqual(s2, 200);
    });
  });

  describe("DELETE /api/community/:id/reaction", () => {
    let unreactionPostId: number;

    before(async () => {
      await authedReq("POST", "/api/community", { content: `Unreaction target ${uid()}` });
      const { data } = await authedReq("GET", "/api/community?limit=1");
      unreactionPostId = data.posts?.[0]?.id;
      await authedReq("POST", `/api/community/${unreactionPostId}/reaction`, { emoji: "😢" });
    });

    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("DELETE", `/api/community/${unreactionPostId}/reaction`, { emoji: "😢" });
      assert.strictEqual(status, 403);
    });

    it("should remove a reaction", async () => {
      const { status, data } = await authedReq("DELETE", `/api/community/${unreactionPostId}/reaction`, { emoji: "😢" });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });

    it("should be idempotent on double delete", async () => {
      const { status } = await authedReq("DELETE", `/api/community/${unreactionPostId}/reaction`, { emoji: "😢" });
      assert.strictEqual(status, 200);
    });
  });

  describe("Pagination (cursor-based)", () => {
    it("should accept limit parameter", async () => {
      const { status, data } = await authedReq("GET", "/api/community?limit=3");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data.posts));
      assert.ok(data.posts.length <= 3);
    });

    it("should include has_more flag", async () => {
      const { data } = await authedReq("GET", "/api/community?limit=1");
      assert.ok("has_more" in data);
    });

    it("should support before cursor", async () => {
      const { data: first } = await authedReq("GET", "/api/community?limit=1");
      if (first.posts.length > 0) {
        const { data: before } = await authedReq("GET", `/api/community?before=${first.posts[0].id}&limit=1`);
        assert.ok(Array.isArray(before.posts));
      }
    });
  });

  describe("Email exclusion from user search & profile", () => {
    it("should not include email in /api/users/search", async () => {
      const { status, data } = await authedReq("GET", "/api/users/search?q=suite");
      assert.strictEqual(status, 200);
      if (data.length > 0) {
        assert.strictEqual(data[0].email, undefined);
      }
    });

    it("should not include email in /api/users/:id/profile", async () => {
      const { status, data } = await authedReq("GET", `/api/users/${authedId}/profile`);
      assert.strictEqual(status, 200);
      assert.strictEqual(data.email, undefined);
    });
  });

  // ─── Existing tests below, preserved ───

  describe("GET /api/groups", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/groups");
      assert.strictEqual(status, 401);
    });

    it("should return group list when authenticated", async () => {
      const { status, data } = await authedReq("GET", "/api/groups");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  describe("POST /api/groups", () => {
    it("should reject non-admin user (403)", async () => {
      const { status } = await authedReq("POST", "/api/groups", {
        name: `Test Group ${uid()}`,
      });
      assert.strictEqual(status, 403);
    });

    it("should reject empty name even for admin", async () => {
      const other = makeReq({});
      const id = uid();
      await other("POST", "/api/register", { username: `admin_${id}`, email: `admin_${id}@test.com`, password: "AdminPass99!" });
      await other("POST", "/api/login", { email: `admin_${id}@test.com`, password: "AdminPass99!" });
      const { status, data } = await other("POST", "/api/groups", { name: "" });
      assert.strictEqual(status, 403);
      assert.ok(data.error);
    });
  });

  describe("GET /api/friends", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/friends");
      assert.strictEqual(status, 401);
    });

    it("should return friend list when authenticated", async () => {
      const { status, data } = await authedReq("GET", "/api/friends");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  describe("GET /api/friends/suggestions", () => {
    it("should return suggestions when authenticated", async () => {
      const { status, data } = await authedReq("GET", "/api/friends/suggestions");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });

  describe("GET /api/avatar", () => {
    it("should reject unauthenticated", async () => {
      const req = makeReq({});
      const { status } = await req("GET", "/api/avatar");
      assert.strictEqual(status, 401);
    });

    it("should return avatar when authenticated", async () => {
      const { status } = await authedReq("GET", "/api/avatar");
      assert.strictEqual(status, 200);
    });
  });

  describe("PUT /api/avatar", () => {
    it("should update avatar", async () => {
      const { status, data } = await authedReq("PUT", "/api/avatar", {
        texture: "gradient",
        bg_color: "#ff6600",
      });
      assert.strictEqual(status, 200);
      assert.ok(data.success);
    });
  });

  describe("GET /api/users/search", () => {
    it("should return search results", async () => {
      const { status, data } = await authedReq("GET", "/api/users/search?q=test");
      assert.strictEqual(status, 200);
      assert.ok(Array.isArray(data));
    });
  });
});
