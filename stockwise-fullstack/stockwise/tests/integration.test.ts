import { describe, it, before, after } from "node:test";
import assert from "node:assert";

let server;
const BASE = "http://localhost:3001";

function uid() {
  return Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

function makeReq(state) {
  return async function req(method, path, body = null, extraHeaders = {}) {
    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (state.sessionCookie) headers["Cookie"] = state.sessionCookie;
    if (state.csrfToken && !["/api/login", "/api/register"].includes(path)) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }
    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`${BASE}${path}`, opts);
    const setCookie = res.headers.get("set-cookie");
    if (setCookie) {
      state.sessionCookie = setCookie.split(";")[0];
      const m = setCookie.match(/csrfToken=([^;]+)/);
      if (m) state.csrfToken = m[1];
    }
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: res.status, data };
  };
}

before(async () => {
  const [{ createServer }, { app }] = await Promise.all([
    import("http"),
    import("../server.js"),
  ]);
  server = createServer(app);
  await new Promise((resolve) => server.listen(3001, resolve));
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe("Auth: Registration", () => {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);
  const id = uid();

  it("should register with valid data", async () => {
    const { status, data } = await req("POST", "/api/register", {
      username: `reg_${id}`,
      email: `reg_${id}@test.com`,
      password: "ValidPass99!",
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.success, true);
  });

  it("should reject duplicate registration", async () => {
    const { status, data } = await req("POST", "/api/register", {
      username: `reg_${id}`,
      email: `reg_${id}@test.com`,
      password: "ValidPass99!",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.error.includes("already exists"));
  });

  it("should reject short password when not test mode", async () => {
    const id2 = uid();
    const { status, data } = await req("POST", "/api/register", {
      username: `reg_${id2}`,
      email: `reg_${id2}@test.com`,
      password: "Ab1!",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.error);
  });

  it("should reject invalid email", async () => {
    const id2 = uid();
    const { status, data } = await req("POST", "/api/register", {
      username: `reg_${id2}`,
      email: "not-an-email",
      password: "ValidPass99!",
    });
    assert.strictEqual(status, 400);
    assert.ok(data.error);
  });

  it("should reject missing fields", async () => {
    const { status } = await req("POST", "/api/register", {
      username: "foo",
    });
    assert.strictEqual(status, 400);
  });
});

describe("Auth: Login", () => {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);
  const id = uid();
  const email = `login_${id}@test.com`;
  const password = "LoginPass99!";

  before(async () => {
    await req("POST", "/api/register", {
      username: `login_${id}`,
      email,
      password,
    });
  });

  it("should login with valid credentials", async () => {
    const { status, data } = await req("POST", "/api/login", {
      email,
      password,
    });
    assert.strictEqual(status, 200);
    assert.strictEqual(data.loggedIn, true);
    assert.strictEqual(data.email, email);
    assert.ok(data.csrfToken);
  });

  it("should reject wrong password", async () => {
    const { status, data } = await req("POST", "/api/login", {
      email,
      password: "WrongPass99!",
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(data.error, "Invalid credentials");
  });

  it("should reject non-existent user", async () => {
    const { status, data } = await req("POST", "/api/login", {
      email: "nobody@nowhere.com",
      password: "Whatever99!",
    });
    assert.strictEqual(status, 400);
    assert.strictEqual(data.error, "Invalid credentials");
  });

  it("should provide session to /api/me after login", async () => {
    const { status, data } = await req("GET", "/api/me");
    assert.strictEqual(status, 200);
    assert.strictEqual(data.loggedIn, true);
    assert.strictEqual(data.email, email);
  });

  it("should include avatar and role in /api/me", async () => {
    const { data } = await req("GET", "/api/me");
    assert.ok(data.avatar);
    assert.ok(data.role);
    assert.ok(typeof data.is_verified === "boolean");
  });
});

describe("Auth: Session", () => {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);
  const id = uid();
  const email = `session_${id}@test.com`;
  const password = "SessionPass99!";

  before(async () => {
    await req("POST", "/api/register", {
      username: `session_${id}`,
      email,
      password,
    });
    await req("POST", "/api/login", { email, password });
  });

  it("should persist across multiple requests", async () => {
    const { data: me1 } = await req("GET", "/api/me");
    assert.strictEqual(me1.loggedIn, true);
    const { data: me2 } = await req("GET", "/api/me");
    assert.strictEqual(me2.loggedIn, true);
    assert.strictEqual(me1.email, me2.email);
  });

  it("should logout and invalidate session", async () => {
    const { data: logoutData } = await req("POST", "/api/logout");
    assert.strictEqual(logoutData.success, true);
    const { data: me } = await req("GET", "/api/me");
    assert.strictEqual(me.loggedIn, false);
  });
});

describe("API: Health & unauthenticated access", () => {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);

  it("should return health status", async () => {
    const { status, data } = await req("GET", "/api/health");
    assert.strictEqual(status, 200);
    assert.strictEqual(data.status, "ok");
    assert.ok(data.database);
    assert.ok(data.timestamp);
  });

  it("should reject unauthenticated portfolio access", async () => {
    const { status, data } = await req("GET", "/api/portfolio");
    assert.strictEqual(status, 401);
    assert.strictEqual(data.error, "Not logged in");
  });

  it("should reject POST without CSRF token on protected routes", async () => {
    const state2 = { sessionCookie: "", csrfToken: "" };
    const req2 = makeReq(state2);
    const id2 = uid();
    const email2 = `csrf2_${id2}@test.com`;
    await req2("POST", "/api/register", {
      username: `csrf2_${id2}`,
      email: email2,
      password: "TestPass99!",
    });
    await req2("POST", "/api/login", { email: email2, password: "TestPass99!" });
    // POST to a protected endpoint without X-CSRF-Token header
    const headers = { "Content-Type": "application/json" };
    if (state2.sessionCookie) headers["Cookie"] = state2.sessionCookie;
    const res = await fetch(`${BASE}/api/portfolio`, {
      method: "POST",
      headers,
      body: JSON.stringify({ symbol: "BTC", name: "Bitcoin", quantity: 1, buy_price: 50000 }),
    });
    assert.strictEqual(res.status, 403);
    const data = await res.json();
    assert.ok(data.error.includes("CSRF"));
  });
});
