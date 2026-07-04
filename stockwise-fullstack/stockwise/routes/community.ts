import express from "express";
import { JSDOM } from "jsdom";
import DOMPurify from "dompurify";
import { requireAuth, rateLimit } from "../middleware/auth.js";
import prisma from "../services/db.js";
import logger from "../services/logger.js";
import {
  postSchema,
  groupCreateSchema,
  friendIdSchema,
  avatarUpdateSchema,
} from "../schemas/community.ts";

const window = new JSDOM("").window;
const purify = DOMPurify(window);
function sanitize(str: string) {
  return purify.sanitize(str, { ALLOWED_TAGS: [] }).trim();
}

const BOT_TIPS = {
  "/": [
    "Welcome to StockWise! Try the Live Tracker from the top nav.",
    "Create an account to unlock Portfolio, Signals and Community.",
    "Don't invest more than you can afford to lose — signals are educational only.",
  ],
  "/tracker": [
    "Prices refresh every 30 seconds automatically.",
    "Click any coin row to see full 24h change breakdown.",
    "Set price alerts from here — they show up in your Portfolio.",
    "Use the search box to filter the 100+ tracked coins.",
  ],
  "/signals": [
    "Signals combine RSI, MACD, Bollinger Bands and news sentiment.",
    "Buy = bullish confluence of 3+ indicators.",
    "Sell = 3+ indicators pointing down.",
    "Hold = mixed signals — wait for clarity.",
  ],
  "/portfolio": [
    "Paste your CoinDCX API keys to auto-sync your real holdings.",
    "Price alerts trigger in-app and in the Portfolio panel.",
    "Tracks both your manual entries and CoinDCX-synced positions.",
  ],
  "/community": [
    "Join a group to talk about specific coins or strategies.",
    "Stickers add personality — click the emoji button in the composer.",
    "Unverified accounts cannot post until email is confirmed.",
  ],
  "/analyzer": [
    "Paste your holdings to get a diversity score, risk rating and improvements.",
    "Works on both manual entries and CoinDCX-synced portfolios.",
    "Re-run any time you add or remove a position.",
  ],
};

export default (db: any) => {
  const router = express.Router();

  // ─── COMMUNITY HUB & MESSAGES ──────────────────────────────────
  router.get("/community", async (req, res) => {
    const gid = req.query.group_id ? parseInt(String(req.query.group_id), 10) : null;
    const rid = req.query.recipient_id
      ? parseInt(String(req.query.recipient_id), 10)
      : null;
    const before = req.query.before ? parseInt(String(req.query.before), 10) : null;
    const limit = Math.min(parseInt(String(req.query.limit || "50"), 10) || 50, 100);
    try {
      const whereBase = rid
        ? {
            OR: [
              { user_id: req.session.userId, recipient_id: rid },
              { user_id: rid, recipient_id: req.session.userId },
            ],
          }
        : gid
          ? { group_id: gid }
          : { group_id: null, recipient_id: null };
      const where = before ? { ...whereBase, id: { lt: before } } : whereBase;
      const orderBy = rid ? { created_at: "asc" as const } : { created_at: "desc" as const };

      const posts = await prisma.communityPost.findMany({
        where,
        orderBy,
        take: limit + 1,
        include: {
          user: {
            select: {
              avatar_bg_color: true,
              avatar_accessory: true,
              avatar_energy: true,
              role: true,
            },
          },
        },
      });

      const hasMore = posts.length > limit;
      if (hasMore) posts.pop();

      // Batch query likes and reactions for these posts
      const postIds = posts.map(p => p.id);
      const userId = req.session?.userId || null;
      const [allLikes, allReactions] = await Promise.all([
        userId ? prisma.postLike.findMany({
          where: { post_id: { in: postIds }, user_id: userId },
          select: { post_id: true },
        }) : Promise.resolve([]),
        prisma.postReaction.findMany({
          where: { post_id: { in: postIds } },
          include: { user: { select: { username: true } } },
        }),
      ]);
      const likedPostIds = new Set(allLikes.map(l => l.post_id));
      // Group reactions by post: { [post_id]: [{ emoji, users: [{ username }] }] }
      const reactionsByPost = new Map<number, Map<string, Set<string>>>();
      for (const r of allReactions) {
        if (!reactionsByPost.has(r.post_id)) reactionsByPost.set(r.post_id, new Map());
        const emojiMap = reactionsByPost.get(r.post_id)!;
        if (!emojiMap.has(r.emoji)) emojiMap.set(r.emoji, new Set());
        emojiMap.get(r.emoji)!.add(r.user?.username || "Unknown");
      }

      const formatted = posts.map((p) => ({
        id: p.id,
        user_id: p.user_id,
        username: p.username,
        content: p.content,
        coin: p.coin,
        recipient_id: p.recipient_id,
        likes: p.likes,
        liked: likedPostIds.has(p.id),
        group_id: p.group_id,
        updated_at: p.updated_at.toISOString(),
        created_at: p.created_at.toISOString(),
        avatar_bg_color: p.user?.avatar_bg_color || "#00e5a0",
        avatar_accessory: p.user?.avatar_accessory || "none",
        avatar_energy: p.user?.avatar_energy || "none",
        role: p.user?.role || "user",
        reactions: [...(reactionsByPost.get(p.id) || new Map()).entries()].map(([emoji, usernames]) => ({
          emoji, users: [...usernames], count: usernames.size,
        })),
      }));
      res.json({ posts: formatted, has_more: hasMore });
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/community", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid post data", details: parsed.error.issues });
    const { content, coin, group_id, recipient_id } = parsed.data;
    const sanitized = sanitize(content);
    if (!sanitized) return res.status(400).json({ error: "Content is required" });
    const userId = req.session.userId!;
    const gid = group_id || null;
    const rid = recipient_id || null;

    try {
      if (gid) {
        const member = await prisma.groupMember.findUnique({
          where: {
            group_id_user_id: {
              group_id: gid,
              user_id: userId,
            },
          },
        });
        if (!member)
          return res.status(403).json({ error: "Join this group to post here" });
      }

      await prisma.communityPost.create({
        data: {
          user_id: userId,
          username: req.session.username!,
          content: sanitized,
          coin: coin || "",
          group_id: gid,
          recipient_id: rid,
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/community/:id", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = postSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid post data", details: parsed.error.issues });
    const { content, coin } = parsed.data;
    const sanitized = sanitize(content);
    if (!sanitized) return res.status(400).json({ error: "Content is required" });
    const userId = req.session.userId!;

    try {
      const post = await prisma.communityPost.findUnique({
        where: { id: Number(req.params.id) },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (post.user_id !== userId && me?.role !== "moderator")
        return res
          .status(403)
          .json({ error: "Not authorized to edit this post" });

      await prisma.communityPost.update({
        where: { id: Number(req.params.id) },
        data: {
          content: sanitized,
          coin: coin || post.coin,
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/community/:id", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const userId = req.session.userId!;
    try {
      const post = await prisma.communityPost.findUnique({
        where: { id: Number(req.params.id) },
      });
      if (!post) return res.status(404).json({ error: "Post not found" });

      const me = await prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });
      if (post.user_id !== userId && me?.role !== "moderator")
        return res
          .status(403)
          .json({ error: "Not authorized to delete this post" });

      await prisma.communityPost.delete({
        where: { id: Number(req.params.id) },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/community/:id/like", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const userId = req.session.userId!;
      const post = await prisma.communityPost.findUnique({ where: { id: postId } });
      if (!post) return res.status(404).json({ error: "Post not found" });
      await prisma.postLike.upsert({
        where: { post_id_user_id: { post_id: postId, user_id: userId } },
        create: { post_id: postId, user_id: userId },
        update: {},
      });
      const likeCount = await prisma.postLike.count({ where: { post_id: postId } });
      await prisma.communityPost.update({ where: { id: postId }, data: { likes: likeCount } });
      return res.json({ success: true, likes: likeCount });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/community/:id/like", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const userId = req.session.userId!;
      const post = await prisma.communityPost.findUnique({ where: { id: postId } });
      if (!post) return res.status(404).json({ error: "Post not found" });
      await prisma.postLike.deleteMany({ where: { post_id: postId, user_id: userId } });
      const likeCount = await prisma.postLike.count({ where: { post_id: postId } });
      await prisma.communityPost.update({ where: { id: postId }, data: { likes: likeCount } });
      return res.json({ success: true, likes: likeCount });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── POST REACTIONS ──────────────────────────────────────────
  router.post("/community/:id/reaction", requireAuth, rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const userId = req.session.userId!;
      const { emoji } = req.body;
      if (!emoji || typeof emoji !== "string") return res.status(400).json({ error: "emoji is required" });
      const post = await prisma.communityPost.findUnique({ where: { id: postId } });
      if (!post) return res.status(404).json({ error: "Post not found" });
      await prisma.postReaction.upsert({
        where: { post_id_user_id_emoji: { post_id: postId, user_id: userId, emoji: emoji.trim() } },
        create: { post_id: postId, user_id: userId, emoji: emoji.trim() },
        update: {},
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/community/:id/reaction", requireAuth, rateLimit({ windowMs: 60000, max: 30 }), async (req, res) => {
    try {
      const postId = Number(req.params.id);
      const userId = req.session.userId!;
      const { emoji } = req.body;
      if (!emoji || typeof emoji !== "string") return res.status(400).json({ error: "emoji is required" });
      await prisma.postReaction.deleteMany({
        where: { post_id: postId, user_id: userId, emoji: emoji.trim() },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── GROUPS / GROUP-CHAT ──────────────────────────────────────────
  router.get("/groups", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    try {
      const groups = await prisma.group.findMany({
        orderBy: { created_at: "desc" },
        include: {
          creator: {
            select: { username: true },
          },
          _count: {
            select: { members: true },
          },
        },
      });

      const myMemberships = await prisma.groupMember.findMany({
        where: { user_id: userId },
        select: { group_id: true },
      });
      const myGroupIds = new Set(myMemberships.map((m) => m.group_id));

      const formatted = groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        created_by: g.created_by,
        created_at: g.created_at.toISOString(),
        creator_name: g.creator?.username || "Unknown",
        member_count: g._count.members,
        is_member: myGroupIds.has(g.id) ? 1 : 0,
      }));
      return res.json(formatted);
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/groups/:id", requireAuth, async (req, res) => {
    const gid = parseInt(String(req.params.id), 10);
    try {
      const group = await prisma.group.findUnique({
        where: { id: gid },
        include: {
          creator: {
            select: { username: true },
          },
          members: {
            include: {
              user: {
                select: { username: true },
              },
            },
            orderBy: { joined_at: "desc" },
          },
        },
      });
      if (!group) return res.status(404).json({ error: "Group not found" });

      const formatted = {
        id: group.id,
        name: group.name,
        description: group.description,
        created_by: group.created_by,
        created_at: group.created_at.toISOString(),
        creator_name: group.creator?.username || "Unknown",
        members: group.members.map((m) => ({
          id: m.id,
          group_id: m.group_id,
          user_id: m.user_id,
          joined_at: m.joined_at.toISOString(),
          username: m.user?.username || "Unknown",
        })),
      };
      return res.json(formatted);
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/groups", requireAuth, rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.session.userId! } });
    if (!user || (user.role !== "admin" && user.role !== "moderator")) {
      return res.status(403).json({ error: "Admin or moderator access required" });
    }
    const parsed = groupCreateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid group data", details: parsed.error.issues });
    const { name, description } = parsed.data;
    const userId = req.session.userId!;
    try {
      const group = await prisma.group.create({
        data: {
          name: name.trim(),
          description: description || "",
          created_by: userId,
          members: {
            create: {
              user_id: userId,
            },
          },
        },
      });
      return res.json({ success: true, id: group.id });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/groups/:id/join", requireAuth, rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    const userId = req.session.userId!;
    const gid = parseInt(String(req.params.id), 10);
    try {
      const exists = await prisma.group.findUnique({ where: { id: gid } });
      if (!exists) return res.status(404).json({ error: "Group not found" });

      await prisma.groupMember.upsert({
        where: {
          group_id_user_id: {
            group_id: gid,
            user_id: userId,
          },
        },
        create: {
          group_id: gid,
          user_id: userId,
        },
        update: {},
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/groups/:id/leave", requireAuth, rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    const userId = req.session.userId!;
    const gid = parseInt(String(req.params.id), 10);
    try {
      await prisma.groupMember.deleteMany({
        where: {
          group_id: gid,
          user_id: userId,
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.delete("/groups/:id", requireAuth, rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    const gid = parseInt(String(req.params.id), 10);
    try {
      const user = await prisma.user.findUnique({ where: { id: req.session.userId! } });
      if (!user || (user.role !== "admin" && user.role !== "moderator")) {
        return res.status(403).json({ error: "Admin or moderator access required" });
      }
      const group = await prisma.group.findUnique({ where: { id: gid } });
      if (!group) return res.status(404).json({ error: "Group not found" });
      await prisma.group.delete({ where: { id: gid } });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── FRIENDS ROUTES ───────────────────────────────────────────
  router.get("/users/search", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const q = String(req.query.q || "").toLowerCase();
    try {
      const results = await prisma.user.findMany({
        where: {
          username: { contains: q },
          id: { not: userId },
        },
        select: {
          id: true,
          username: true,
          role: true,
          avatar_bg_color: true,
        },
        take: 10,
      });
      return res.json(results);
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/friends", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    try {
      const list = await prisma.friend.findMany({
        where: {
          OR: [{ user_id: userId }, { friend_id: userId }],
        },
        include: {
          user: {
            select: {
              id: true,
              username: true,
              role: true,
              avatar_bg_color: true,
              avatar_accessory: true,
              avatar_energy: true,
            },
          },
          friend: {
            select: {
              id: true,
              username: true,
              role: true,
              avatar_bg_color: true,
              avatar_accessory: true,
              avatar_energy: true,
            },
          },
        },
      });

      // My accepted friend IDs as a Set for O(1) lookups
      const myFriends = await prisma.friend.findMany({
        where: {
          OR: [{ user_id: userId }, { friend_id: userId }],
          status: "accepted",
        },
      });
      const myFriendIds = new Set(myFriends.map((mf) =>
        mf.user_id === userId ? mf.friend_id : mf.user_id,
      ));

      // Batch: single query for all other users' friends instead of N+1
      const otherUserIds = list.map(f => f.user_id === userId ? f.friend_id : f.user_id);
      const allOtherFriends = otherUserIds.length > 0
        ? await prisma.friend.findMany({
            where: {
              OR: [
                { user_id: { in: otherUserIds } },
                { friend_id: { in: otherUserIds } },
              ],
              status: "accepted",
            },
          })
        : [];

      // Build map: userId -> Set of their friend IDs
      const othersFriendMap = new Map<number, Set<number>>();
      for (const f of allOtherFriends) {
        const uid = f.user_id;
        const fid = f.friend_id;
        if (otherUserIds.includes(uid)) {
          if (!othersFriendMap.has(uid)) othersFriendMap.set(uid, new Set());
          othersFriendMap.get(uid)!.add(fid);
        }
        if (otherUserIds.includes(fid)) {
          if (!othersFriendMap.has(fid)) othersFriendMap.set(fid, new Set());
          othersFriendMap.get(fid)!.add(uid);
        }
      }

      const formatted = list.map((f) => {
        const otherUser = f.user_id === userId ? f.friend : f.user;
        const otherFriendIds = othersFriendMap.get(otherUser.id) || new Set();

        let mutualCount = 0;
        for (const fid of otherFriendIds) {
          if (myFriendIds.has(fid)) mutualCount++;
        }

        return {
          id: otherUser.id,
          username: otherUser.username,
          role: otherUser.role,
          avatar_bg_color: otherUser.avatar_bg_color,
          avatar_accessory: otherUser.avatar_accessory,
          avatar_energy: otherUser.avatar_energy,
          status: f.status,
          friend_since: f.created_at.toISOString(),
          sender_id: f.user_id,
          mutual_count: mutualCount,
        };
      });
      res.json(formatted);
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/friends/request", requireAuth, rateLimit({ windowMs: 60000, max: 15 }), async (req, res) => {
    const parsed = friendIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    const { friend_id } = parsed.data;
    const userId = req.session.userId!;
    try {
      const existing = await prisma.friend.findFirst({
        where: {
          OR: [
            { user_id: userId, friend_id },
            { user_id: friend_id, friend_id: userId },
          ],
        },
      });
      if (existing)
        return res.status(400).json({ error: "Friend request already exists" });

      await prisma.friend.create({
        data: {
          user_id: userId,
          friend_id,
          status: "pending",
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/friends/request-by-identifier", requireAuth, rateLimit({ windowMs: 60000, max: 15 }), async (req, res) => {
    const currentUserId = req.session.userId!;
    const { identifier } = req.body;
    if (!identifier)
      return res.status(400).json({ error: "Identifier is required" });
    let targetUser: { id: number; username: string } | null = null;
    const input = identifier.trim();

    try {
      const idMatch = input.match(/^#?(\d+)$/);
      if (idMatch) {
        const targetId = parseInt(idMatch[1], 10);
        targetUser = await prisma.user.findUnique({
          where: { id: targetId },
          select: { id: true, username: true },
        });
      }

      if (!targetUser && input.includes("@")) {
        const raw: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, username FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
          input,
        ) as any;
        if (raw.length > 0) {
          targetUser = { id: raw[0].id, username: raw[0].username };
        }
      }

      if (!targetUser) {
        const raw: any[] = await prisma.$queryRawUnsafe(
          `SELECT id, username FROM users WHERE LOWER(username) = LOWER($1) LIMIT 1`,
          input,
        ) as any;
        if (raw.length > 0) {
          targetUser = { id: raw[0].id, username: raw[0].username };
        }
      }

      if (!targetUser) {
        return res
          .status(404)
          .json({ error: "User not found. Check the ID or Email." });
      }

      if (targetUser.id === currentUserId) {
        return res
          .status(400)
          .json({ error: "You cannot add yourself as a friend." });
      }

      const existing = await prisma.friend.findFirst({
        where: {
          OR: [
            { user_id: currentUserId, friend_id: targetUser.id },
            { user_id: targetUser.id, friend_id: currentUserId },
          ],
        },
      });

      if (existing) {
        if (existing.status === "accepted") {
          return res.status(400).json({
            error: `You are already friends with ${targetUser.username}.`,
          });
        } else {
          if (existing.user_id === currentUserId) {
            return res
              .status(400)
              .json({ error: "Friend request already sent." });
          } else {
            await prisma.friend.update({
              where: {
                user_id_friend_id: {
                  user_id: targetUser.id,
                  friend_id: currentUserId,
                },
              },
              data: { status: "accepted" },
            });
            return res.json({
              success: true,
              accepted: true,
              username: targetUser.username,
            });
          }
        }
      }

      await prisma.friend.create({
        data: {
          user_id: currentUserId,
          friend_id: targetUser.id,
          status: "pending",
        },
      });

      return res.json({ success: true, username: targetUser.username });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/friends/accept", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = friendIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    const { friend_id } = parsed.data;
    const userId = req.session.userId!;
    try {
      const result = await prisma.friend.updateMany({
        where: {
          user_id: friend_id,
          friend_id: userId,
          status: "pending",
        },
        data: {
          status: "accepted",
        },
      });
      if (result.count === 0) {
        return res.status(404).json({ error: "Friend request not found" });
      }
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.post("/friends/cancel", requireAuth, rateLimit({ windowMs: 60000, max: 20 }), async (req, res) => {
    const parsed = friendIdSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request", details: parsed.error.issues });
    const { friend_id } = parsed.data;
    const userId = req.session.userId!;
    try {
      await prisma.friend.deleteMany({
        where: {
          OR: [
            { user_id: userId, friend_id },
            { user_id: friend_id, friend_id: userId },
          ],
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/users/:id/profile", requireAuth, async (req, res) => {
    const userId = req.session.userId!;
    const targetId = parseInt(String(req.params.id), 10);
    try {
      const targetUser = await prisma.user.findUnique({
        where: { id: targetId },
        select: {
          id: true,
          username: true,
          role: true,
          avatar_name: true,
          avatar_bg_color: true,
          avatar_accessory: true,
          avatar_energy: true,
          created_at: true,
        },
      });

      if (!targetUser) return res.status(404).json({ error: "User not found" });

      const holdings = await prisma.portfolio.findMany({
        where: { user_id: targetId },
        select: { symbol: true },
      });

      const myId = userId;
      const myFriends = await prisma.friend.findMany({
        where: {
          OR: [{ user_id: myId }, { friend_id: myId }],
          status: "accepted",
        },
      });
      const myFriendIds = myFriends.map((f) =>
        f.user_id === myId ? f.friend_id : f.user_id,
      );

      const targetFriends = await prisma.friend.findMany({
        where: {
          OR: [{ user_id: targetId }, { friend_id: targetId }],
          status: "accepted",
        },
      });
      const targetFriendIds = targetFriends.map((f) =>
        f.user_id === targetId ? f.friend_id : f.user_id,
      );

      const mutualCount = myFriendIds.filter((id) =>
        targetFriendIds.includes(id),
      ).length;

      return res.json({
        id: targetUser.id,
        username: targetUser.username,
        role: targetUser.role || "user",
        created_at: targetUser.created_at.toISOString(),
        avatar: {
          name: targetUser.avatar_name || "",
          bg_color: targetUser.avatar_bg_color || "#00e5a0",
          accessory: targetUser.avatar_accessory || "none",
          energy: targetUser.avatar_energy || "none",
        },
        holdings: holdings.map((h) => h.symbol.toUpperCase()),
        mutual_count: mutualCount,
      });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/friends/suggestions", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId!;
      const myHoldings = await prisma.portfolio.findMany({
        where: { user_id: userId },
        select: { symbol: true },
      });
      const myHoldingSymbols = myHoldings.map((h) => h.symbol.toUpperCase());

      if (myHoldingSymbols.length === 0) {
        return res.json([]);
      }

      const potentialFriends = await prisma.user.findMany({
        where: {
          id: { not: userId },
          friends: {
            none: { friend_id: userId },
          },
          friendOf: {
            none: { user_id: userId },
          },
          portfolios: {
            some: {
              symbol: { in: myHoldingSymbols },
            },
          },
        },
        select: {
          id: true,
          username: true,
          role: true,
          avatar_bg_color: true,
          portfolios: {
            where: {
              symbol: { in: myHoldingSymbols },
            },
            select: {
              symbol: true,
            },
          },
        },
        take: 12, // Take a bit more to sort in memory
      });

      const suggestions = potentialFriends.map((u) => {
        const uniqueSymbols = new Set(u.portfolios.map((p) => p.symbol.toUpperCase()));
        return {
          id: u.id,
          username: u.username,
          role: u.role,
          avatar_bg_color: u.avatar_bg_color,
          shared_holdings: uniqueSymbols.size,
        };
      });

      suggestions.sort((a, b) => b.shared_holdings - a.shared_holdings);
      return res.json(suggestions.slice(0, 8));
    } catch (e) {
      logger.error({ err: e }, "Error fetching suggestions");
      return res.json([]);
    }
  });

  // ─── AVATAR STUDIO ──────────────────────────────────────────
  router.get("/avatar", requireAuth, async (req, res) => {
    try {
      const u = await prisma.user.findUnique({
        where: { id: req.session.userId },
        select: {
          avatar_name: true,
          avatar_bg_color: true,
          avatar_texture: true,
          avatar_accessory: true,
          avatar_energy: true,
          avatar_finish: true,
        },
      });
      res.json({
        name: u?.avatar_name || "",
        bg_color: u?.avatar_bg_color || "#00e5a0",
        texture: u?.avatar_texture || "solid",
        accessory: u?.avatar_accessory || "none",
        energy: u?.avatar_energy || "none",
        finish: u?.avatar_finish || "solid",
      });
    } catch (e: any) {
      console.error(e); res.status(500).json({ error: "Internal server error" });
    }
  });

  router.put("/avatar", requireAuth, rateLimit({ windowMs: 60000, max: 10 }), async (req, res) => {
    const parsed = avatarUpdateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid avatar data", details: parsed.error.issues });
    const { name, bg_color, texture, accessory, energy, finish } = parsed.data;
    try {
      await prisma.user.update({
        where: { id: req.session.userId },
        data: {
          avatar_name: name || "",
          avatar_bg_color: bg_color || "#00e5a0",
          avatar_texture: texture || "solid",
          avatar_accessory: accessory || "none",
          avatar_energy: energy || "none",
          avatar_finish: finish || "solid",
        },
      });
      return res.json({ success: true });
    } catch (e: any) {
      console.error(e); return res.status(500).json({ error: "Internal server error" });
    }
  });

  router.get("/avatar-presets", requireAuth, (req, res) => {
    res.json({
      colors: [
        { id: "green", hex: "#00e5a0", name: "Emerald" },
        { id: "blue", hex: "#00bfff", name: "Sky" },
        { id: "purple", hex: "#a855f7", name: "Amethyst" },
        { id: "pink", hex: "#ff6b9d", name: "Rose" },
        { id: "gold", hex: "#f59e0b", name: "Gold" },
        { id: "red", hex: "#ff4757", name: "Scarlet" },
        { id: "cyan", hex: "#22d3ee", name: "Cyan" },
        { id: "orange", hex: "#fb923c", name: "Sunset" },
        { id: "slate", hex: "#64748b", name: "Slate" },
      ],
      textures: [
        {
          id: "solid",
          name: "Solid",
          css: "linear-gradient(135deg, VAR, VAR)",
        },
        {
          id: "radial",
          name: "Radial",
          css: "radial-gradient(circle, VAR 40%, transparent 70%)",
        },
        {
          id: "diagonal",
          name: "Diagonal",
          css: "repeating-linear-gradient(45deg, VAR, VAR 8px, transparent 8px, transparent 16px)",
        },
        {
          id: "stripes",
          name: "Stripes",
          css: "repeating-linear-gradient(90deg, VAR 0px, VAR 6px, transparent 6px, transparent 14px)",
        },
        {
          id: "dots",
          name: "Dots",
          css: "radial-gradient(circle, VAR 2px, transparent 2px) 0 0 / 10px 10px, VAR",
        },
      ],
      accessories: [
        { id: "none", emoji: "", label: "None" },
        { id: "crown", emoji: "👑", label: "Crown" },
        { id: "halo", emoji: "✨", label: "Halo" },
        { id: "headband", emoji: "🎧", label: "Band" },
        { id: "glasses", emoji: "🕶️", label: "Glasses" },
        { id: "cap", emoji: "🧢", label: "Cap" },
        { id: "bow", emoji: "🎀", label: "Bow" },
        { id: "emerald", emoji: "💎", label: "Gem" },
      ],
      energies: [
        { id: "none", name: "None", glow: "none" },
        { id: "neon", name: "Neon", glow: "0 0 18px VAR" },
        { id: "glow", name: "Glow", glow: "0 0 30px VAR, 0 0 60px VAR" },
        {
          id: "fire",
          name: "Fire",
          glow: "0 0 22px #ff6b35, 0 0 44px #ff4757",
        },
        { id: "ice", name: "Ice", glow: "0 0 22px #00bfff, 0 0 44px #1e90ff" },
      ],
      finishes: [
        { id: "solid", name: "Solid" },
        { id: "gradient", name: "Gradient" },
        { id: "metallic", name: "Metallic" },
      ],
      backgrounds: [
        {
          id: "deep",
          name: "Deep Space",
          gradient:
            "radial-gradient(ellipse at center, #1a1a2e 0%, #0d0d1a 100%)",
        },
        {
          id: "ocean",
          name: "Ocean",
          gradient:
            "radial-gradient(ellipse at bottom, #0f2027 0%, #203a43 50%, #2c5364 100%)",
        },
        {
          id: "sunset",
          name: "Sunset",
          gradient: "radial-gradient(ellipse at top, #1a0a2e, #3d1a00)",
        },
        {
          id: "forest",
          name: "Forest",
          gradient:
            "radial-gradient(ellipse at bottom, #0d1f0d 0%, #0a1a0a 100%)",
        },
        {
          id: "aurora",
          name: "Aurora",
          gradient: "radial-gradient(ellipse at top, #0d1a2e 0%, #0a0f1e 100%)",
        },
      ],
    });
  });

  // ─── GUIDE BOT TIPS ──────────────────────────────────────────
  router.get("/bot-tips", (req, res) => {
    const path = String(req.query.path || "/");
    const tips = (BOT_TIPS as Record<string, string[]>)[path] || BOT_TIPS["/"];
    const tip = tips[Math.floor(Math.random() * tips.length)];
    res.json({ tip, page: path });
  });

  return router;
};
