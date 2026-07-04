import { describe, it } from "node:test";
import assert from "node:assert";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  profileSchema,
} from "../../schemas/auth.js";

describe("registerSchema", () => {
  it("accepts valid registration", () => {
    const result = registerSchema.safeParse({
      username: "testuser",
      email: "test@example.com",
      password: "abcdef",
    });
    assert.ok(result.success);
  });

  it("rejects short username", () => {
    const result = registerSchema.safeParse({
      username: "ab",
      email: "test@example.com",
      password: "abcdef",
    });
    assert.ok(!result.success);
    assert.ok(result.error?.issues.some((i) => i.message.includes("3-50")));
  });

  it("rejects invalid email", () => {
    const result = registerSchema.safeParse({
      username: "testuser",
      email: "not-an-email",
      password: "abcdef",
    });
    assert.ok(!result.success);
  });

  it("rejects short password", () => {
    const result = registerSchema.safeParse({
      username: "testuser",
      email: "test@example.com",
      password: "abc12",
    });
    assert.ok(!result.success);
  });

  it("allows optional phone field", () => {
    const result = registerSchema.safeParse({
      username: "testuser",
      email: "test@example.com",
      password: "abcdef",
      phone: "+1234567890",
    });
    assert.ok(result.success);
  });
});

describe("loginSchema", () => {
  it("accepts valid login", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "password123",
    });
    assert.ok(result.success);
  });

  it("rejects empty password", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid email", () => {
    const result = loginSchema.safeParse({
      email: "bad",
      password: "password123",
    });
    assert.ok(!result.success);
  });

  it("accepts optional remember field", () => {
    const result = loginSchema.safeParse({
      email: "test@example.com",
      password: "password123",
      remember: true,
    });
    assert.ok(result.success);
  });
});

describe("forgotPasswordSchema", () => {
  it("accepts valid email", () => {
    const result = forgotPasswordSchema.safeParse({
      email: "test@example.com",
    });
    assert.ok(result.success);
  });

  it("rejects invalid email", () => {
    const result = forgotPasswordSchema.safeParse({
      email: "",
    });
    assert.ok(!result.success);
  });
});

describe("resetPasswordSchema", () => {
  it("accepts valid token and password", () => {
    const result = resetPasswordSchema.safeParse({
      token: "valid-token-123",
      password: "abcdef",
    });
    assert.ok(result.success);
  });

  it("rejects empty token", () => {
    const result = resetPasswordSchema.safeParse({
      token: "",
      password: "abcdef",
    });
    assert.ok(!result.success);
  });

  it("rejects short password", () => {
    const result = resetPasswordSchema.safeParse({
      token: "token-123",
      password: "abc12",
    });
    assert.ok(!result.success);
  });
});

describe("profileSchema", () => {
  it("accepts valid profile", () => {
    const result = profileSchema.safeParse({
      username: "testuser",
      email: "test@example.com",
    });
    assert.ok(result.success);
  });

  it("rejects short username", () => {
    const result = profileSchema.safeParse({
      username: "ab",
      email: "test@example.com",
    });
    assert.ok(!result.success);
  });

  it("rejects invalid email", () => {
    const result = profileSchema.safeParse({
      username: "testuser",
      email: "bad",
    });
    assert.ok(!result.success);
  });

  it("allows optional phone", () => {
    const result = profileSchema.safeParse({
      username: "testuser",
      email: "test@example.com",
      phone: "123-456-7890",
    });
    assert.ok(result.success);
  });
});
