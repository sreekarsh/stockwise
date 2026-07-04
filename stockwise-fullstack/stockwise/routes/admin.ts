import express from "express";
import { requireAuth, rateLimit } from "../middleware/auth.js";
import prisma from "../services/db.js";
import { logBuffer } from "../services/logBuffer.js";

function requireAdmin(roles = ["admin", "moderator"]) {
  return async (req: any, res: any, next: any) => {
    const me = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { role: true },
    });
    if (!me || !roles.includes(me.role))
      return res.status(403).json({ error: "Admin access required" });
    next();
  };
}

export default (db: any) => {
  const router = express.Router();

  // ─── DASHBOARD STATS ─────────────────────────────────────────
  router.get("/admin/stats", requireAuth, requireAdmin(["admin"]), async (req, res) => {
    try {
      const [
        totalUsers,
        totalPosts,
        totalGroups,
        totalAlerts,
        totalPortfolios,
        pendingVerifications,
        pendingResets,
        activeToday,
        recentLogins,
      ] = await Promise.all([
        prisma.user.count(),
        prisma.communityPost.count(),
        prisma.group.count(),
        prisma.alert.count(),
        prisma.portfolio.count(),
        prisma.user.count({ where: { is_verified: 0 } }),
        prisma.user.count({
          where: { reset_token: { not: "" }, reset_token_expiry: { gt: new Date() } },
        }),
        prisma.loginLog.count({
          where: { login_at: { gte: new Date(Date.now() - 86400000) }, success: 1 },
        }),
        prisma.loginLog.findMany({
          where: { success: 1 },
          orderBy: { login_at: "desc" },
          take: 10,
          select: { username: true, login_at: true, ip_address: true, login_type: true },
        }),
      ]);

      return res.json({
        totalUsers,
        totalPosts,
        totalGroups,
        totalAlerts,
        totalPortfolios,
        pendingVerifications,
        pendingResets,
        activeToday,
        recentLogins,
      });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── LIST USERS (enhanced) ────────────────────────────────────
  router.get("/admin/users", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      const q = String(req.query.q || "").toLowerCase();
      const roleFilter = String(req.query.role || "");
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "50"), 10)));
      const skip = (page - 1) * limit;

      const where: any = {};
      if (q) where.OR = [{ username: { contains: q } }, { email: { contains: q } }];
      if (roleFilter && ["admin", "moderator", "vip", "user", "supporter", "member"].includes(roleFilter)) {
        where.role = roleFilter;
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true, username: true, email: true, phone: true,
            role: true, is_verified: true, created_at: true,
            coindcx_sync_status: true, trader_level: true,
            _count: { select: { posts: true, portfolios: true, alerts: true, logins: true } },
          },
          orderBy: { created_at: "desc" },
          skip,
          take: limit,
        }),
        prisma.user.count({ where }),
      ]);

      return res.json({ users, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── SINGLE USER DETAIL ──────────────────────────────────────
  router.get("/admin/users/:id", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      const uid = parseInt(String(req.params.id), 10);
      const user = await prisma.user.findUnique({
        where: { id: uid },
        select: {
          id: true, username: true, email: true, phone: true,
          role: true, is_verified: true, created_at: true,
          coindcx_key: true, coindcx_sync_status: true, coindcx_total_invested: true,
          trader_xp: true, trader_level: true, demo_balance: true,
          avatar_name: true, avatar_bg_color: true,
          _count: { select: { posts: true, portfolios: true, alerts: true, logins: true, postLikes: true, friends: true } },
        },
      });
      if (!user) return res.status(404).json({ error: "User not found" });

      const [holdings, recentPosts, recentLogins] = await Promise.all([
        prisma.portfolio.findMany({ where: { user_id: uid }, select: { symbol: true, quantity: true, buy_price: true, asset_type: true } }),
        prisma.communityPost.findMany({ where: { user_id: uid }, orderBy: { created_at: "desc" }, take: 10, select: { id: true, content: true, likes: true, created_at: true } }),
        prisma.loginLog.findMany({ where: { user_id: uid }, orderBy: { login_at: "desc" }, take: 20, select: { login_type: true, ip_address: true, user_agent: true, success: true, login_at: true } }),
      ]);

      return res.json({ ...user, holdings, recentPosts, recentLogins });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── SET USER ROLE ──────────────────────────────────────────
  router.post("/admin/set-role", requireAuth, requireAdmin(["admin"]), rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
      const { userId, role } = req.body;
      if (!["admin", "moderator", "vip", "user", "supporter", "member"].includes(role))
        return res.status(400).json({ error: "Invalid role" });
      const target = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { id: true, role: true } });
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "admin" && req.session.userId !== target.id)
        return res.status(403).json({ error: "Cannot change another admin's role" });
      await prisma.user.update({ where: { id: Number(userId) }, data: { role } });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── TOGGLE VERIFICATION ────────────────────────────────────
  router.post("/admin/verify-user", requireAuth, requireAdmin(["admin"]), async (req, res) => {
    try {
      const { userId } = req.body;
      const user = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { id: true, is_verified: true } });
      if (!user) return res.status(404).json({ error: "User not found" });
      await prisma.user.update({ where: { id: user.id }, data: { is_verified: user.is_verified ? 0 : 1 } });
      return res.json({ success: true, is_verified: user.is_verified ? 0 : 1 });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── DELETE USER ────────────────────────────────────────────
  router.post("/admin/delete-user", requireAuth, requireAdmin(["admin"]), rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    try {
      const { userId } = req.body;
      if (Number(userId) === req.session.userId)
        return res.status(400).json({ error: "Cannot delete yourself" });
      const target = await prisma.user.findUnique({ where: { id: Number(userId) }, select: { id: true, role: true } });
      if (!target) return res.status(404).json({ error: "User not found" });
      if (target.role === "admin")
        return res.status(403).json({ error: "Cannot delete another admin" });
      await prisma.user.delete({ where: { id: target.id } });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── ACTIVITY LOG ───────────────────────────────────────────
  router.get("/admin/activity", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "30"), 10)));
      const skip = (page - 1) * limit;

      const [logs, total] = await Promise.all([
        prisma.loginLog.findMany({
          orderBy: { login_at: "desc" },
          skip,
          take: limit,
          select: { id: true, username: true, email: true, login_type: true, ip_address: true, user_agent: true, success: true, login_at: true },
        }),
        prisma.loginLog.count(),
      ]);

      return res.json({ logs, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── PASSWORD RESET REQUESTS ────────────────────────────────
  router.get("/admin/reset-requests", requireAuth, requireAdmin(["admin"]), async (req, res) => {
    try {
      const requests = await prisma.user.findMany({
        where: { reset_token: { not: "" }, reset_token_expiry: { gt: new Date() } },
        select: { id: true, username: true, email: true, reset_token: true, reset_token_expiry: true },
        orderBy: { reset_token_expiry: "asc" },
      });
      return res.json(requests.map(r => ({ id: r.id, username: r.username, email: r.email, token: r.reset_token, expires: r.reset_token_expiry!.getTime() })));
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GENERATE RESET TOKEN (admin) ───────────────────────────
  router.post("/admin/generate-reset-token", requireAuth, requireAdmin(["admin"]), async (req, res) => {
    try {
      const { identifier } = req.body;
      if (!identifier) return res.status(400).json({ error: "identifier is required" });

      const input = String(identifier).trim();
      let user: { id: number; username: string; email: string } | null = null;

      const idMatch = input.match(/^#?(\d+)$/);
      if (idMatch) {
        const uid = parseInt(idMatch[1], 10);
        user = await prisma.user.findUnique({
          where: { id: uid },
          select: { id: true, username: true, email: true },
        });
      }

      if (!user && input.includes("@")) {
        const raw: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, username, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          input,
        );
        if (raw.length > 0) {
          user = { id: raw[0].id, username: raw[0].username, email: raw[0].email };
        }
      }

      if (!user) {
        const raw: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, username, email FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          input,
        );
        if (raw.length > 0) {
          user = { id: raw[0].id, username: raw[0].username, email: raw[0].email };
        }
      }

      if (!user) return res.status(404).json({ error: "User not found. Check the ID, email, or username." });

      const crypto = await import("crypto");
      const token = crypto.randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 600000);

      await prisma.user.update({
        where: { id: user.id },
        data: { reset_token: token, reset_token_expiry: expiry },
      });

      return res.json({ success: true, userId: user.id, username: user.username, email: user.email, token, expires: expiry.getTime() });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── COMMUNITY POSTS (moderation) ───────────────────────────
  router.get("/admin/posts", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      const page = Math.max(1, parseInt(String(req.query.page || "1"), 10));
      const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || "30"), 10)));
      const skip = (page - 1) * limit;

      const [posts, total] = await Promise.all([
        prisma.communityPost.findMany({
          orderBy: { created_at: "desc" },
          skip,
          take: limit,
          select: { id: true, username: true, user_id: true, content: true, likes: true, created_at: true, updated_at: true },
        }),
        prisma.communityPost.count(),
      ]);

      return res.json({ posts, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── DELETE POST (admin moderation) ─────────────────────────
  router.delete("/admin/posts/:id", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      const post = await prisma.communityPost.findUnique({ where: { id: Number(req.params.id) } });
      if (!post) return res.status(404).json({ error: "Post not found" });
      await prisma.communityPost.delete({ where: { id: post.id } });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── LOGS ANALYSIS ────────────────────────────────────────────
  router.get("/admin/logs", requireAuth, requireAdmin(["admin", "moderator"]), async (req, res) => {
    try {
      return res.json(logBuffer.getAnalysis());
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
};
