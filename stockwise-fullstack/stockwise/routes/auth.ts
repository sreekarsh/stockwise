import express from "express";
import crypto from "crypto";
import {
  requireAuth,
  rateLimit,
  checkLockout,
  recordFailedAttempt,
  resetFailedAttempts,
} from "../middleware/auth.js";
import mailService from "../services/mailService.js";
import logger from "../services/logger.js";
import bcrypt from "bcryptjs";
import prisma from "../services/db.js";
import { encrypt, decrypt } from "../services/cryptoService.js";
import { env } from "../config/env.js";
import { z } from "zod";
import {
  registerSchema,
  loginSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  profileSchema,
} from "../schemas/auth.ts";

async function isPasswordBreached(password: string) {
  try {
    const sha1 = crypto
      .createHash("sha1")
      .update(password)
      .digest("hex")
      .toUpperCase();
    const prefix = sha1.slice(0, 5);
    const suffix = sha1.slice(5);

    const response = await fetch(
      `https://api.pwnedpasswords.com/range/${prefix}`,
      {
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      console.warn("HIBP API returned non-OK response:", response.status);
      return false;
    }
    const text = await response.text();
    const lines = text.split("\r\n");
    for (const line of lines) {
      const [hashSuffix, count] = line.split(":");
      if (hashSuffix === suffix) {
        return parseInt(count, 10) > 0;
      }
    }
    return false;
  } catch (err) {
    console.warn(
      "Failed to check breached password against HIBP:",
      (err as Error).message,
    );
    return false;
  }
}

function safeDecrypt(val: string) {
  if (!val) return "";
  try {
    return decrypt(val);
  } catch {
    return "";
  }
}

/**
 * Reliably extract the real client IP from a request.
 *
 * Priority order:
 *  1. req.ip  — set by Express when trust proxy is configured (handles X-Forwarded-For)
 *  2. X-Forwarded-For header — manual fallback if req.ip is falsy
 *  3. req.socket.remoteAddress — raw TCP socket address (last resort)
 *
 * Also normalises:
 *  - "::ffff:x.x.x.x"  →  "x.x.x.x"   (IPv4-mapped IPv6)
 *  - "::1"             →  "127.0.0.1"  (IPv6 loopback)
 */
function getClientIp(req: any) {
  let raw =
    req.ip ||
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.socket?.remoteAddress ||
    "unknown";

  // Strip IPv4-mapped IPv6 prefix (::ffff:1.2.3.4 → 1.2.3.4)
  if (raw.startsWith("::ffff:")) raw = raw.slice(7);
  // Normalise IPv6 loopback
  if (raw === "::1") raw = "127.0.0.1";

  return raw || "unknown";
}

export default (db: any) => {
  const router = express.Router();

  const router_post = router.post.bind(router);
  const router_get = router.get.bind(router);

  router_post(
    "/register",
    checkLockout,
    rateLimit({ windowMs: 60000, max: process.env.NODE_ENV === "test" ? 50 : 5 }),
    async (req, res) => {
      const parsed = registerSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.errors[0].message });
      }
      const { username, email, password, phone } = parsed.data;
      const isTest =
        process.env.NODE_ENV === "test" ||
        process.argv.some((arg) => arg.includes("test"));
      if (!isTest) {
        const isBreached = await isPasswordBreached(password);
        if (isBreached) {
          return res
            .status(400)
            .json({
              error:
                "This password has been exposed in a data breach. Please choose a different password.",
            });
        }
      }
      try {
        const role =
          email.toLowerCase() === mailService.OWNER_EMAIL.toLowerCase()
            ? "admin"
            : "user";
        const passwordHash = await bcrypt.hash(password, 10);

        const user = await prisma.user.create({
          data: {
            username,
            email: email.toLowerCase(),
            password: passwordHash,
            phone: phone || "",
            role,
          },
        });

        await new Promise<void>((resolve, reject) => {
          req.session.regenerate(err => err ? reject(err) : resolve());
        });
        req.session.userId = user.id;
        req.session.username = username;
        req.session.role = user.role;
        const csrfToken = req.session.csrfToken || crypto.randomBytes(32).toString("hex");
        if (!req.session.csrfToken) req.session.csrfToken = csrfToken;

        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "unknown";

        await prisma.loginLog.create({
          data: {
            user_id: user.id,
            username,
            email: email.toLowerCase(),
            login_type: "register",
            ip_address: ip,
            user_agent: userAgent,
            success: 1,
          },
        });

        res.cookie("rememberLogin", "true", {
          maxAge: 30 * 24 * 60 * 60 * 1000,
          httpOnly: true,
          secure: env.NODE_ENV === "production" || Boolean(env.DOMAIN),
          sameSite: "lax",
        });

        return res.json({
          success: true,
          username,
          phone: phone || "",
          csrfToken,
          message: "Account created! Please contact your administrator for account activation if needed.",
        });
      } catch (e: any) {
        const code = e?.code || "UNKNOWN_ERROR";
        if (code === "P2002")
          return res
            .status(400)
            .json({ error: "Username or email already exists" });
        console.error("Registration error:", e);
        return res.status(500).json({ error: `Server error (${code})` });
      }
    },
  );

  router_post(
    "/login",
    checkLockout,
    rateLimit({ windowMs: 60000, max: 10 }),
    async (req, res) => {
      try {
        const parsed = loginSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: parsed.error.errors[0].message });
        }
        const { email, password, remember } = parsed.data;
        const ip = getClientIp(req);
        const userAgent = req.headers["user-agent"] || "unknown";

        const user = await prisma.user.findFirst({
          where: { email: email.toLowerCase() },
        });

        if (!user) {
          await recordFailedAttempt(ip);
          await prisma.loginLog.create({
            data: {
              user_id: null,
              username: "unknown",
              email: email.toLowerCase(),
              login_type: "login",
              ip_address: ip,
              user_agent: userAgent,
              success: 0,
            },
          });
          return res.status(400).json({ error: "Invalid credentials" });
        }

        const match = await bcrypt.compare(password, user.password);
        if (!match) {
          await recordFailedAttempt(ip);
          await prisma.loginLog.create({
            data: {
              user_id: user.id,
              username: user.username,
              email: user.email,
              login_type: "login",
              ip_address: ip,
              user_agent: userAgent,
              success: 0,
            },
          });
          return res.status(400).json({ error: "Invalid credentials" });
        }

        await resetFailedAttempts(ip);

        if (
          email.toLowerCase() === mailService.OWNER_EMAIL.toLowerCase() &&
          user.role !== "admin"
        ) {
          await prisma.user.update({
            where: { id: user.id },
            data: { role: "admin" },
          });
          user.role = "admin";
        }

        await new Promise<void>((resolve, reject) => {
          req.session.regenerate(err => err ? reject(err) : resolve());
        });
        req.session.userId = user.id;
        req.session.username = user.username;
        req.session.role = user.role;

        await prisma.loginLog.create({
          data: {
            user_id: user.id,
            username: user.username,
            email: user.email,
            login_type: "login",
            ip_address: ip,
            user_agent: userAgent,
            success: 1,
          },
        });

        if (remember) {
          res.cookie("rememberLogin", "true", {
            maxAge: 30 * 24 * 60 * 60 * 1000,
            httpOnly: true,
            secure: env.NODE_ENV === "production" || Boolean(env.DOMAIN),
            sameSite: "lax",
          });
        }

        const coindcxKey = safeDecrypt(user.coindcx_key);
        const coindcxSecret = safeDecrypt(user.coindcx_secret);

        const csrfToken =
          req.session.csrfToken || crypto.randomBytes(32).toString("hex");
        if (!req.session.csrfToken) req.session.csrfToken = csrfToken;

        return res.json({
          loggedIn: true,
          id: user.id,
          username: user.username,
          email: user.email,
          phone: user.phone || "",
          profile_color: user.profile_color || "dark",
          currency: user.currency || user.profile_color || "dark",
          theme: user.theme || "",
          font_style: user.font_style || "dm-sans",
          tracker_font: user.tracker_font || "dm-sans",
          role: user.role || "user",
          is_verified: !!user.is_verified,
          avatar: {
            name: user.avatar_name || "",
            bg_color: user.avatar_bg_color || "#00e5a0",
            texture: user.avatar_texture || "solid",
            accessory: user.avatar_accessory || "none",
            energy: user.avatar_energy || "none",
            finish: user.avatar_finish || "solid",
          },
          has_coindcx: Boolean(coindcxKey && coindcxSecret),
          has_coindcx_secret: Boolean(coindcxSecret),
          has_news_key: Boolean(user.news_api_key),
          has_community_key: Boolean(user.community_api_key),
          csrfToken,
        });
      } catch (e: any) {
        const code = e?.code || "UNKNOWN_ERROR";
        console.error("Login error:", e);
        return res.status(500).json({ error: `Server error (${code})` });
      }
    },
  );

  router_post("/logout", (req, res) => {
    res.clearCookie("rememberLogin");
    req.session.destroy((err) => {
      if (err) {
        console.error("Logout error:", err);
        return res.status(500).json({ error: "Logout failed" });
      }
      return res.json({ success: true });
    });
  });

  router_post("/forgot-password", checkLockout, rateLimit({ windowMs: 60000, max: 5 }), async (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { email } = parsed.data;
    const user = await prisma.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, username: true },
    });

    if (!user)
      return res.json({
        success: true,
        message: "If that email exists, the owner has been notified.",
      });

    const token = crypto.randomBytes(32).toString("hex");
    const expiry = new Date(Date.now() + 600000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        reset_token: token,
        reset_token_expiry: expiry,
      },
    });

    const html = `
      <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0d1117;color:#e6edf3;padding:2rem;border-radius:12px;border:1px solid #30363d">
        <h2 style="color:#00e5a0;margin:0 0 1rem 0">StockWise - Password Reset</h2>
        <p style="color:#8b949e;">Hi ${user.username},</p>
        <p style="color:#e6edf3;">Use the token below to reset your password. It expires in 10 minutes.</p>
        <div style="background:#161b22;border:1px solid rgba(0,229,160,0.35);border-radius:10px;padding:1.2rem">
          <p style="color:#8b949e;margin:0 0 0.6rem 0;font-size:0.82rem;text-transform:uppercase">Reset Token:</p>
          <code style="color:#00e5a0;word-break:break-all;font-size:0.95rem;font-weight:bold">${token}</code>
        </div>
      </div>
    `;

    await mailService.sendEmail(
      email,
      `[StockWise] Password Reset - ${user.username}`,
      html,
    );
    return res.json({
      success: true,
      message:
        "If that email exists, a reset token has been sent.",
    });
  });

  router_post(
    "/reset-password",
    rateLimit({ windowMs: 60000, max: 5 }),
    async (req, res) => {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { token, password } = parsed.data;
    const isTest =
      process.env.NODE_ENV === "test" ||
      process.argv.some((arg) => arg.includes("test"));
    if (!isTest) {
      const isBreached = await isPasswordBreached(password);
      if (isBreached) {
        return res
          .status(400)
          .json({
            error:
              "This password has been exposed in a data breach. Please choose a different password.",
          });
      }
    }

    const user = await prisma.user.findFirst({
      where: {
        reset_token: token,
        reset_token_expiry: { gt: new Date() },
      },
    });

    if (!user)
      return res.status(400).json({ error: "Invalid or expired token" });

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        reset_token: "",
        reset_token_expiry: null,
      },
    });

    return res.json({ success: true });
  });

  router_post("/profile", requireAuth, async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const { username, email, phone } = parsed.data;

    const dupEmail = await prisma.user.findFirst({
      where: {
        email: email.trim().toLowerCase(),
        id: { not: req.session.userId },
      },
      select: { id: true },
    });
    if (dupEmail)
      return res.status(400).json({ error: "Email is already in use" });

    const dupUser = await prisma.user.findFirst({
      where: {
        username: { equals: username.trim() },
        id: { not: req.session.userId },
      },
      select: { id: true },
    });
    if (dupUser)
      return res.status(400).json({ error: "Username is already taken" });

    try {
      await prisma.user.update({
        where: { id: req.session.userId },
        data: {
          username: username.trim(),
          email: email.trim().toLowerCase(),
          phone: phone || "",
        },
      });
    } catch (e) {
      console.error("profile update sql error:", (e as Error).message);
      return res
        .status(500)
        .json({ error: "Database error — please contact support" });
    }

    const updated = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: {
        id: true,
        username: true,
        email: true,
        phone: true,
        role: true,
        is_verified: true,
        created_at: true,
        avatar_name: true,
        avatar_bg_color: true,
        avatar_texture: true,
        avatar_accessory: true,
        avatar_energy: true,
        avatar_finish: true,
      },
    });
    if (updated) req.session.username = updated.username;
    return res.json({ success: true, user: updated });
  });

  router_post("/api-keys", requireAuth, async (req, res) => {
    const {
      coindcx_key,
      coindcx_secret,
      news_api_key,
      community_api_key,
      coingecko_key,
    } = req.body;
    const data: Record<string, any> = {};
    if ("coindcx_key" in req.body && coindcx_key !== "••••••••••••••••") {
      data.coindcx_key = coindcx_key ? encrypt(coindcx_key.trim()) : "";
    }
    if ("coindcx_secret" in req.body && coindcx_secret !== "••••••••••••••••") {
      data.coindcx_secret = coindcx_secret ? encrypt(coindcx_secret.trim()) : "";
    }
    if ("news_api_key" in req.body) {
      data.news_api_key = news_api_key ? encrypt((news_api_key || "").trim()) : "";
    }
    if ("community_api_key" in req.body) {
      data.community_api_key = community_api_key ? encrypt((community_api_key || "").trim()) : "";
    }
    if ("coingecko_key" in req.body) {
      data.coingecko_key = coingecko_key ? encrypt((coingecko_key || "").trim()) : "";
    }
    if (!Object.keys(data).length)
      return res.status(400).json({ error: "No keys provided" });

    await prisma.user.update({
      where: { id: req.session.userId },
      data,
    });
    return res.json({ success: true });
  });

  router_get("/prefs", requireAuth, async (req, res) => {
    const row = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { profile_color: true, currency: true, theme: true, font_style: true, tracker_font: true },
    });
    res.json({
      profile_color: row?.profile_color || "dark",
      currency: row?.currency || "",
      theme: row?.theme || "",
      font_style: row?.font_style || "dm-sans",
      tracker_font: row?.tracker_font || "dm-sans",
    });
  });

  const prefsSchema = z.object({
    profile_color: z.enum(["dark", "light", "ocean", "sunset"]).optional(),
    currency: z.enum(["inr", "usd", "eur", "gbp"]).optional(),
    theme: z.string().max(30).optional(),
    font_style: z.enum(["dm-sans", "inter", "jetbrains-mono", "syne"]).optional(),
    tracker_font: z.enum(["dm-sans", "jetbrains-mono", "mono"]).optional(),
  });

  router_post("/prefs", requireAuth, async (req, res) => {
    const parsed = prefsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.errors[0].message });
    }
    const data: Record<string, any> = {};
    if (parsed.data.profile_color) data.profile_color = parsed.data.profile_color;
    if (parsed.data.currency) data.currency = parsed.data.currency;
    if (parsed.data.theme) data.theme = parsed.data.theme;
    if (parsed.data.font_style) data.font_style = parsed.data.font_style;
    if (parsed.data.tracker_font) data.tracker_font = parsed.data.tracker_font;

    if (Object.keys(data).length) {
      await prisma.user.update({
        where: { id: req.session.userId },
        data,
      });
    }
    return res.json({ success: true });
  });

  router_get("/me", rateLimit({ windowMs: 60000, max: 60 }), async (req, res) => {
    if (!req.session.csrfToken)
      req.session.csrfToken = crypto.randomBytes(32).toString("hex");
    if (!req.session.userId)
      return res.json({ loggedIn: false, csrfToken: req.session.csrfToken });

    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
    });

    if (!user)
      return res.json({ loggedIn: false, csrfToken: req.session.csrfToken });

    const coindcxKey = safeDecrypt(user.coindcx_key);
    const coindcxSecret = safeDecrypt(user.coindcx_secret);

    const coingeckoKey = safeDecrypt(user.coingecko_key);
    const newsKey = safeDecrypt(user.news_api_key);
    const communityKey = safeDecrypt(user.community_api_key);

    res.json({
      loggedIn: true,
      id: user.id,
      username: user.username,
      email: user.email,
      phone: user.phone || "",
      profile_color: user.profile_color || "dark",
      currency: user.currency || user.profile_color || "dark",
      theme: user.theme || "",
      font_style: user.font_style || "dm-sans",
      tracker_font: user.tracker_font || "dm-sans",
      coindcx_key: coindcxKey ? "••••••••••••••••" : "",
      coingecko_key: coingeckoKey ? "••••••••••••••••" : "",
      news_api_key: newsKey ? "••••••••••••••••" : "",
      community_api_key: communityKey ? "••••••••••••••••" : "",
      role: user.role || "user",
      is_verified: !!user.is_verified,
      avatar: {
        name: user.avatar_name || "",
        bg_color: user.avatar_bg_color || "#00e5a0",
        texture: user.avatar_texture || "solid",
        accessory: user.avatar_accessory || "none",
        energy: user.avatar_energy || "none",
      },
      has_coindcx: Boolean(coindcxKey && coindcxSecret),
      has_coindcx_secret: Boolean(coindcxSecret),
      has_coingecko: Boolean(coingeckoKey),
      has_news_key: Boolean(newsKey),
      has_community_key: Boolean(communityKey),
      csrfToken: req.session.csrfToken,
      coindcx_sync_status: user.coindcx_sync_status || "idle",
      coindcx_last_synced: user.coindcx_last_synced || null,
      coindcx_sync_error: user.coindcx_sync_error || null,
      totalInvestedINR: parseFloat(user.coindcx_total_invested ?? "0"),
      created_at: user.created_at?.toISOString() || null,
      watchlist: (() => { try { return JSON.parse(user.watchlist || "[]"); } catch { return []; } })(),
    });
    return;
  });

  // Save watchlist
  router_post("/watchlist", requireAuth, async (req, res) => {
    const { symbols } = req.body || {};
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ error: "symbols must be an array" });
    }
    const sanitized = symbols.filter((s: any) => typeof s === "string").map((s: string) => s.toUpperCase().trim());
    try {
      await prisma.user.update({
        where: { id: req.session.userId },
        data: { watchlist: JSON.stringify(sanitized) },
      });
      return res.json({ success: true, count: sanitized.length });
    } catch (err) {
      logger.error({ err }, "POST /api/watchlist error");
      return res.status(500).json({ error: "Failed to save watchlist" });
    }
  });

  router_get("/login-logs", requireAuth, async (req, res) => {
    const logs = await prisma.loginLog.findMany({
      where: { user_id: req.session.userId },
      orderBy: { login_at: "desc" },
      take: 50,
    });

    const normalizeIp = (ip: string) => {
      if (!ip) return "unknown";
      if (ip.startsWith("::ffff:")) return ip.slice(7);
      if (ip === "::1") return "127.0.0.1";
      return ip;
    };

    const formatted = logs.map((l) => ({
      id:         l.id,
      username:   l.username,
      email:      l.email,
      login_type: l.login_type,
      ip_address: normalizeIp(l.ip_address ?? ""),
      user_agent: l.user_agent,
      login_at:   l.login_at.toISOString(),
      success:    l.success,   // 1 = success, 0 = failed attempt
    }));
    res.json(formatted);
  });

  router_post("/save-keys", requireAuth, async (req, res) => {
    const { coindcx_key, coindcx_secret, coingecko_key } = req.body;
    const data: Record<string, any> = {};
    if (coindcx_key && coindcx_key !== "••••••••••••••••") {
      data.coindcx_key = encrypt(coindcx_key.trim());
    }
    if (coindcx_secret && coindcx_secret !== "••••••••••••••••") {
      data.coindcx_secret = encrypt(coindcx_secret.trim());
    }
    if (coingecko_key && coingecko_key !== "••••••••••••••••") {
      data.coingecko_key = coingecko_key.trim();
    }
    if (!Object.keys(data).length)
      return res.status(400).json({ error: "No keys provided" });
    await prisma.user.update({
      where: { id: req.session.userId },
      data,
    });
    return res.json({ success: true });
  });

  router_post("/verify-email", requireAuth, async (req, res) => {
    const email = req.body?.email;
    if (!email)
      return res.status(400).json({ error: "Email address required" });

    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { email: true },
    });
    if (!user)
      return res.status(404).json({ error: "User not found" });

    if (user.email.toLowerCase() !== email.toLowerCase())
      return res.status(400).json({ error: "Email does not match your account" });

    await prisma.user.update({
      where: { id: req.session.userId },
      data: { is_verified: 1 },
    });

    const row = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { is_verified: true },
    });
    return res.json({ success: true, is_verified: !!(row && row.is_verified) });
  });

  return router;
};
