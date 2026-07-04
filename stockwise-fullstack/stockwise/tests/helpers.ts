import { createServer } from "http";

const TEST_PORT = 0;

let _server = null;
let _app = null;
let _port = null;

export function uid() {
  return Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

export async function startServer() {
  if (_server) return _port;
  const mod = await import("../server.js");
  _app = mod.app;
  _server = createServer(_app);
  await new Promise((resolve) => {
    _server.listen(TEST_PORT, () => {
      _port = _server.address().port;
      resolve();
    });
  });
  return _port;
}

let _exiting = false;

export async function stopServer() {
  if (_exiting) return;
  _exiting = true;
  if (_server) {
    _server.closeAllConnections();
    await new Promise((resolve) => _server.close(resolve));
    _server = null;
    _app = null;
    _port = null;
  }
  try {
    const mod = await import("../services/db.js");
    await (mod.default || mod.prisma).$disconnect();
  } catch {}
  // Force process exit after cleanup
  setTimeout(() => process.exit(0), 500).unref();
}

export function getPort() {
  return _port;
}

export function makeReq(state) {
  return async function req(method, path, body = null, extraHeaders = {}) {
    const port = _port;
    if (!port) throw new Error("Server not started. Call startServer() first.");

    const headers = { "Content-Type": "application/json", ...extraHeaders };
    if (state.sessionCookie) headers["Cookie"] = state.sessionCookie;
    if (state.csrfToken && !["/api/login", "/api/register", "/api/forgot-password", "/api/reset-password"].includes(path)) {
      headers["X-CSRF-Token"] = state.csrfToken;
    }

    const opts = { method, headers };
    if (body) opts.body = JSON.stringify(body);

    const res = await fetch(`http://127.0.0.1:${port}${path}`, opts);

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
      if (data && typeof data === "object" && typeof data.csrfToken === "string") {
        state.csrfToken = data.csrfToken;
      }
    } catch {
      data = text;
    }

    return { status: res.status, data };
  };
}

export async function registerUser(state) {
  const req = makeReq(state);
  const id = uid();
  const email = `test_${id}@stockwise.test`;
  const password = "TestPass99!";

  const { status, data } = await req("POST", "/api/register", {
    username: `user_${id}`,
    email,
    password,
  });

  if (status !== 200) {
    throw new Error(`Registration failed: ${data.error || status}`);
  }

  return { id, email, password };
}

export async function loginUser(state) {
  const req = makeReq(state);
  const id = uid();
  const email = `login_${id}@stockwise.test`;
  const password = "LoginPass99!";

  const regRes = await req("POST", "/api/register", {
    username: `login_${id}`,
    email,
    password,
  });
  if (regRes.status !== 200) {
    throw new Error(`Registration failed: ${regRes.data.error || regRes.status}`);
  }

  const loginRes = await req("POST", "/api/login", { email, password });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.data.error || loginRes.status}`);
  }

  return { email, password };
}

export async function createAuthedUser() {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);
  const id = uid();
  const email = `authed_${id}@stockwise.test`;
  const password = "Authed99!";

  const regRes = await req("POST", "/api/register", {
    username: `authed_${id}`,
    email,
    password,
  });
  if (regRes.status !== 200) {
    throw new Error(`Registration failed: ${regRes.data?.error || regRes.status}`);
  }

  const loginRes = await req("POST", "/api/login", { email, password });
  if (loginRes.status !== 200) {
    throw new Error(`Login failed: ${loginRes.data?.error || loginRes.status}`);
  }

  return { state, req };
}

export async function withUser(fn) {
  const state = { sessionCookie: "", csrfToken: "" };
  const req = makeReq(state);
  const id = uid();
  const email = `fn_${id}@stockwise.test`;
  const password = "FnPass99!";

  await req("POST", "/api/register", {
    username: `fn_${id}`,
    email,
    password,
  });
  await req("POST", "/api/login", { email, password });

  await fn({ state, req, email, id });
}
