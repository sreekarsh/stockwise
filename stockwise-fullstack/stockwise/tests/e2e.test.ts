import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import { chromium } from "playwright";

let server;
let browser;
let context;
const BASE = "http://localhost:3002";

function uid() {
  return Date.now() + "_" + Math.random().toString(36).slice(2, 8);
}

before(async () => {
  const [{ createServer }, { app }] = await Promise.all([
    import("http"),
    import("../server.js"),
  ]);
  server = createServer(app);
  await new Promise((resolve) => server.listen(3002, resolve));
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  if (context) await context.close();
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
});

describe("E2E: Auth flow", () => {
  it("should load home page and show auth modal on login click", async () => {
    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();

    const modal = page.locator("#authModal");
    await modal.waitFor({ state: "visible" });
    const loginForm = page.locator("#loginForm");
    assert.strictEqual(await loginForm.isVisible(), true);
  });

  it("should register a new user", async () => {
    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Create Account')").click();
    await page.waitForSelector("#authModal.open");

    const id = uid();
    await page.fill("#regUsername", `e2e_${id}`);
    await page.fill("#regEmail", `e2e_${id}@test.com`);
    await page.fill("#regPass", "E2eTest99!");
    await page.locator("#registerForm button[type='submit']").click();

    await page.waitForFunction(() => {
      const el = document.getElementById("authError");
      return el && el.textContent.length > 0 ? "error" : "success";
    }, { timeout: 5000 });

    const authError = await page.textContent("#authError");
    if (authError) {
      assert.fail(`Registration failed: ${authError}`);
    }

    await page.waitForFunction(
      () => !document.getElementById("authModal")?.classList.contains("open"),
      { timeout: 3000 },
    );
  });

  it("should reject duplicate registration", async () => {
    const dupId = uid();
    const dupUser = `dup_${dupId}`;
    const dupEmail = `dup_${dupId}@test.com`;

    // Create user first via API
    await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: dupUser, email: dupEmail, password: "DupPass99!" }),
    });

    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Create Account')").click();
    await page.waitForSelector("#authModal.open");

    await page.fill("#regUsername", dupUser);
    await page.fill("#regEmail", dupEmail);
    await page.fill("#regPass", "DupPass99!");
    await page.locator("#registerForm button[type='submit']").click();

    await page.waitForFunction(() => {
      const el = document.getElementById("authError");
      return el && el.textContent.length > 0;
    }, { timeout: 10000 });

    const errorText = await page.textContent("#authError");
    assert.ok(errorText.length > 0);
  });

  it("should login with valid credentials", async () => {
    const id = uid();
    const email = `e2e_login_${id}@test.com`;
    const password = "E2eLogin99!";

    const res = await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `e2e_login_${id}`,
        email,
        password,
      }),
    });
    assert.strictEqual(res.status, 200);

    context = await browser.newContext({ baseURL: BASE, viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();
    await page.waitForSelector("#authModal.open");

    await page.fill("#loginEmail", email);
    await page.fill("#loginPass", password);
    await page.locator("#loginForm button[type='submit']").click();
    await page.waitForFunction(
      () => !document.getElementById("authModal")?.classList.contains("open"),
      { timeout: 10000 },
    );

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll("#navRight button");
      return Array.from(btns).some((b) => b.textContent.includes("Logout"));
    }, { timeout: 3000 });
  });

  it("should reject wrong password", async () => {
    const id = uid();
    const email = `e2e_wrong_${id}@test.com`;

    await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `e2e_wrong_${id}`,
        email,
        password: "Correct99!",
      }),
    });

    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();
    await page.waitForSelector("#authModal.open");

    await page.fill("#loginEmail", email);
    await page.fill("#loginPass", "WrongPass99!");
    await page.locator("#loginForm button[type='submit']").click();

    await page.waitForFunction(() => {
      const el = document.getElementById("authError");
      return el && el.textContent.length > 0;
    }, { timeout: 5000 });

    const errorText = await page.textContent("#authError");
    assert.ok(errorText.length > 0);
  });

  it("should reject non-existent user", async () => {
    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();
    await page.waitForSelector("#authModal.open");

    await page.fill("#loginEmail", "nobody@nowhere.com");
    await page.fill("#loginPass", "SomePass99!");
    await page.locator("#loginForm button[type='submit']").click();

    await page.waitForFunction(() => {
      const el = document.getElementById("authError");
      return el && el.textContent.length > 0;
    }, { timeout: 5000 });

    const errorText = await page.textContent("#authError");
    assert.ok(errorText.length > 0);
  });

  it("should persist session across pages", async () => {
    const id = uid();
    const email = `e2e_sess_${id}@test.com`;
    const password = "Session99!";

    await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `e2e_sess_${id}`,
        email,
        password,
      }),
    });

    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();
    await page.waitForSelector("#authModal.open");
    await page.fill("#loginEmail", email);
    await page.fill("#loginPass", password);
    await page.locator("#loginForm button[type='submit']").click();

    await page.waitForFunction(
      () => !document.getElementById("authModal")?.classList.contains("open"),
      { timeout: 5000 },
    );

    await page.goto("/signals");
    await page.waitForLoadState("networkidle");

    const hasLogout = await page.evaluate(() => {
      const btns = document.querySelectorAll("#navRight button");
      return Array.from(btns).some((b) => b.textContent.includes("Logout"));
    });
    assert.strictEqual(hasLogout, true);
  });

  it("should logout and invalidate session", async () => {
    const id = uid();
    const email = `e2e_logout_${id}@test.com`;

    await fetch(`${BASE}/api/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: `e2e_logout_${id}`,
        email,
        password: "Logout99!",
      }),
    });

    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    await page.locator("#navRight button:has-text('Login')").click();
    await page.waitForSelector("#authModal.open");
    await page.fill("#loginEmail", email);
    await page.fill("#loginPass", "Logout99!");
    await page.locator("#loginForm button[type='submit']").click();
    await page.waitForFunction(
      () => !document.getElementById("authModal")?.classList.contains("open"),
      { timeout: 5000 },
    );

    await page.evaluate(() => {
      const btns = document.querySelectorAll("#navRight button");
      for (const b of btns) {
        if (b.textContent.includes("Logout")) { b.click(); break; }
      }
    });

    await page.waitForFunction(() => {
      const btns = document.querySelectorAll("#navRight button");
      return Array.from(btns).some((b) => b.textContent.includes("Login"));
    }, { timeout: 3000 });
  });
});

describe("E2E: CSP headers", () => {
  it("should send CSP headers with base-uri and form-action", async () => {
    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    const response = await page.goto("/");
    const headers = response.headers();
    const csp = headers["content-security-policy"] || "";
    assert.ok(csp.includes("base-uri"));
    assert.ok(csp.includes("form-action"));
    assert.ok(csp.includes("frame-ancestors"));
    assert.ok(csp.includes("script-src"));
  });

  it("should not allow eval in script-src", async () => {
    context = await browser.newContext({ baseURL: BASE });
    const page = await context.newPage();
    const response = await page.goto("/");
    const csp = response.headers()["content-security-policy"] || "";
    assert.ok(!csp.includes("unsafe-eval"), "CSP should not contain unsafe-eval");
  });
});
