import { describe, it } from "node:test";
import assert from "node:assert";
import {
  postSchema,
  groupCreateSchema,
  friendIdSchema,
  avatarUpdateSchema,
} from "../../schemas/community.js";

describe("postSchema", () => {
  it("accepts valid post", () => {
    const result = postSchema.safeParse({ content: "Hello world!" });
    assert.ok(result.success);
  });

  it("rejects empty content", () => {
    const result = postSchema.safeParse({ content: "" });
    assert.ok(!result.success);
  });

  it("rejects over-500-char content", () => {
    const result = postSchema.safeParse({ content: "x".repeat(501) });
    assert.ok(!result.success);
  });

  it("defaults coin to empty string", () => {
    const result = postSchema.safeParse({ content: "test" });
    assert.ok(result.success);
    assert.strictEqual(result.data!.coin, "");
  });

  it("accepts group_id as string (transforms to number)", () => {
    const result = postSchema.safeParse({
      content: "test",
      group_id: "42",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.group_id, 42);
  });

  it("accepts null group_id", () => {
    const result = postSchema.safeParse({
      content: "test",
      group_id: null,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.group_id, null);
  });

  it("accepts null recipient_id", () => {
    const result = postSchema.safeParse({
      content: "test",
      recipient_id: null,
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.recipient_id, null);
  });
});

describe("groupCreateSchema", () => {
  it("accepts valid group", () => {
    const result = groupCreateSchema.safeParse({ name: "Traders Club" });
    assert.ok(result.success);
  });

  it("rejects empty name", () => {
    const result = groupCreateSchema.safeParse({ name: "" });
    assert.ok(!result.success);
  });

  it("defaults description to empty string", () => {
    const result = groupCreateSchema.safeParse({ name: "Group" });
    assert.ok(result.success);
    assert.strictEqual(result.data!.description, "");
  });
});

describe("friendIdSchema", () => {
  it("accepts numeric friend_id", () => {
    const result = friendIdSchema.safeParse({ friend_id: 7 });
    assert.ok(result.success);
    assert.strictEqual(result.data!.friend_id, 7);
  });

  it("transforms string friend_id to number", () => {
    const result = friendIdSchema.safeParse({ friend_id: "99" });
    assert.ok(result.success);
    assert.strictEqual(result.data!.friend_id, 99);
  });

  it("rejects missing friend_id", () => {
    const result = friendIdSchema.safeParse({});
    assert.ok(!result.success);
  });
});

describe("avatarUpdateSchema", () => {
  it("accepts avatar with defaults", () => {
    const result = avatarUpdateSchema.safeParse({});
    assert.ok(result.success);
    assert.strictEqual(result.data!.bg_color, "#00e5a0");
    assert.strictEqual(result.data!.texture, "solid");
  });

  it("accepts custom values", () => {
    const result = avatarUpdateSchema.safeParse({
      name: "CoolAvatar",
      bg_color: "#ff0000",
      texture: "gradient",
      accessory: "hat",
      energy: "fire",
    });
    assert.ok(result.success);
    assert.strictEqual(result.data!.name, "CoolAvatar");
    assert.strictEqual(result.data!.bg_color, "#ff0000");
  });
});
