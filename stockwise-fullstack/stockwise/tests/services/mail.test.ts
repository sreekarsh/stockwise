import { describe, it, before, mock } from "node:test";
import assert from "node:assert";

describe("mailService", () => {
  let mod: any;

  before(async () => {
    const nodemailerMod = await import("nodemailer");
    (nodemailerMod.default as any).createTransport = () => ({
      sendMail: mock.fn(() => Promise.resolve()),
    });
    mod = await import("../../services/mailService.js");
  });

  it("exports OWNER_EMAIL", () => {
    assert.strictEqual(mod.OWNER_EMAIL, "sreekarsh44@gmail.com");
  });

  it("sendOwnerEmail returns true on success", async () => {
    const r = await mod.sendOwnerEmail("Hello", "<p>World</p>");
    assert.strictEqual(r, true);
  });

  it("sendOwnerEmail returns false on send failure", async () => {
    const nodemailerMod = await import("nodemailer");
    (nodemailerMod.default as any).createTransport = () => ({
      sendMail: mock.fn(() => Promise.reject(new Error("fail"))),
    });
    const url = new URL("../../services/mailService.js", import.meta.url).href;
    const mod2 = await import(url + "?sendfail=1");
    const r = await mod2.sendOwnerEmail("Subject", "<p>Body</p>");
    assert.strictEqual(r, false);
  });
});
