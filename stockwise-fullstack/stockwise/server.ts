import { env } from "./config/env.js";
import helmet from "helmet";
import dns from "dns";
dns.setDefaultResultOrder("ipv4first");
import express from "express";
import session from "express-session";
import RedisStore from "connect-redis";
import compression from "compression";
import path from "path";
import fs from "fs";
import cookieParser from "cookie-parser";
import pino from "pino";
import http from "http";
import { Server as SocketIoServer } from "socket.io";

import * as Sentry from "@sentry/node";

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === "production" ? 0.1 : 1.0,
    integrations: [Sentry.httpIntegration(), Sentry.expressIntegration()],
  });
}

import { initCsrfToken, csrfProtection } from "./middleware/csrf.js";
import { requireAuth, rateLimit } from "./middleware/auth.js";
import { errorHandler } from "./middleware/errors.js";
import mlService from "./services/mlService.js";
import authRouter from "./routes/auth.js";
import portfolioRouter from "./routes/portfolio.js";
import communityRouter from "./routes/community.js";
import mlRouter from "./routes/ml.js";
import botsFactory from "./routes/bots.js";
import coachRouter from "./routes/aiCoach.js";
import { makeSignals } from "./services/signals.js";
import alertsRouter from "./routes/alerts.js";
import docsRouter from "./routes/docs.js";
import adminRouter from "./routes/admin.js";
import prisma from "./services/db.js";
import { redisClient, waitForRedis } from "./services/redis.js";
import { initWebSocketService } from "./services/websocketService.js";
import { startStockTickerStream } from "./services/stockTickerService.js";
import { startAlertEngine } from "./services/alertService.js";
import {
  startEventLoopMonitor,
  trackRequest,
  trackConnection,
  getMetrics,
} from "./services/metrics.js";
import { getAllFlags } from "./services/featureFlags.js";
import { logBuffer } from "./services/logBuffer.js";
import { buildScheduledRetrainPayload } from "./services/mlRetraining.js";
import crypto from "crypto";

// ── Process-level error handlers ──
process.on("unhandledRejection", (reason) => {
  const log = pino({ name: "system" });
  log.error({ err: reason, type: "unhandledRejection" }, "Unhandled Promise Rejection — exiting");
  logBuffer.trackError(String(reason), reason instanceof Error ? reason.stack : undefined, undefined, 500);
  logBuffer.trackEvent("unhandledRejection", String(reason));
  process.exit(1);
});

process.on("uncaughtException", (err) => {
  const log = pino({ name: "system" });
  log.error({ err, type: "uncaughtException" }, "Uncaught Exception — exiting");
  logBuffer.trackError(err.message || String(err), err.stack, undefined, 500);
  logBuffer.trackEvent("uncaughtException", err.message);
  process.exit(1);
});

const app = express();

app.set("trust proxy", 1);

app.use(compression());

// Generate a CSP nonce per request
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString("base64");
  next();
});

// Nonce injection — serve HTML files with __NONCE__ replaced (before static middleware)
app.use((req, res, next) => {
  const pathname = req.path;
  if (pathname.endsWith(".html") || pathname === "/" || pathname === "") {
    let filePath = pathname === "/" || pathname === "" ? "/index.html" : pathname;
    const candidates: string[] = [
      path.join(distDir, filePath),
      path.join(projectRoot, filePath),
    ];
    for (const fp of candidates) {
      try {
        if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
          const html = fs.readFileSync(fp, "utf-8");
          const modified = html.replace(/__NONCE__/g, res.locals.nonce || "");
          const ext = path.extname(fp);
          const ct = ext === ".html" ? "text/html" : "text/plain";
          res.setHeader("Content-Type", `${ct}; charset=utf-8`);
          res.setHeader("Content-Length", Buffer.byteLength(modified));
          res.end(modified);
          return;
        }
      } catch { /* try next candidate */ }
    }
  }
  next();
});

app.use(
  helmet({
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
    contentSecurityPolicy: false,
  })
);

app.use(express.json({ limit: "10kb" }));
app.use(cookieParser());

const allowedOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:5173",
  "http://127.0.0.1:5173"
];
if (env.DOMAIN) allowedOrigins.push(`https://${env.DOMAIN}`);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Credentials", "true");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type,X-CSRF-Token,Authorization");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  return next();
});

// Determine project root (differs in dev vs Docker production)
const _rootDir = import.meta.dirname;
const _isDistRun = _rootDir.endsWith("/dist") || _rootDir.endsWith("\\dist");
const projectRoot = _isDistRun ? path.resolve(_rootDir, "..") : _rootDir;

// Serve Vite-built client bundle
const distDir = path.join(projectRoot, "dist");
const isProd = !!(env.DOMAIN && env.DOMAIN !== "localhost");
if (fs.existsSync(distDir)) {
  app.use(
    express.static(distDir, {
      maxAge: isProd ? "1y" : 0,
      immutable: isProd,
      redirect: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
        }
      },
    })
  );
}

// Serve root static files
app.use(
  express.static(projectRoot, {
    extensions: ["html"],
    redirect: false,
    setHeaders(res, filePath) {
      if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
      }
    },
  })
);

// Custom CSP with per-request nonce (replaces helmet's static CSP)
app.use((req, res, next) => {
  const n = res.locals.nonce || "";
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${n}' https://cdn.jsdelivr.net https://unpkg.com`,
    `script-src-attr 'unsafe-inline'`,
    `style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com https://unpkg.com`,
    `img-src 'self' data: https://images.unsplash.com https://static.coingecko.com https://assets.coingecko.com https://coin-images.coingecko.com https://raw.githubusercontent.com https://assets.coincap.io https://cdn.tickerlogos.com https://logo.clearbit.com https://ui-avatars.com https://logos.hunter.io`,
    `connect-src 'self' ws://localhost:3000 wss://localhost:3000 ws://127.0.0.1:3000 wss://127.0.0.1:3000 http://localhost:3000 http://127.0.0.1:3000 https://api.coingecko.com https://api.binance.com wss://stream.binance.com:9443 https://*.ingest.sentry.io${env.DOMAIN ? ` https://${env.DOMAIN} wss://${env.DOMAIN}` : ""}`,
    `font-src 'self' https://fonts.gstatic.com`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
    `report-uri /api/csp-violation`,
  ].join("; ");
  res.setHeader("Content-Security-Policy", csp);
  next();
});

const sessionStore = await (async () => {
  if (env.NODE_ENV === "production") {
    const client = await waitForRedis();
    if (!client) {
      console.warn("Redis not available in production — falling back to MemoryStore. Set REDIS_URL for production.");
      return new session.MemoryStore();
    }
    console.log("Production mode — using RedisStore");
    return new RedisStore({ client });
  }
  return new session.MemoryStore();
})();

const sessionMiddleware = session({
  secret: env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    secure: "auto",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
});

app.use(sessionMiddleware);

import logger from "./services/logger.js";

app.use((req, res, next) => {
  const start = Date.now();
  trackConnection(1);
  res.on("finish", () => {
    const ms = Date.now() - start;
    logger.info({ method: req.method, path: req.path, status: res.statusCode, duration: ms });
    logBuffer.trackRequest(req.method, req.path, res.statusCode, ms);
    trackRequest(req.method, req.route?.path || req.path, res.statusCode, ms);
    trackConnection(-1);
  });
  next();
});

app.use(initCsrfToken);
app.use(csrfProtection);

// ── API v1 router (versioned) ──
const v1 = express.Router();

// Mount all existing routes under v1
v1.use(authRouter(prisma));
v1.use(portfolioRouter(prisma));
v1.use(communityRouter(prisma));
v1.use("/ml", mlRouter(prisma));
v1.use(alertsRouter);
v1.use(docsRouter);
v1.use(adminRouter(prisma));

const botsModule = botsFactory(prisma);
v1.use("/demo", botsModule.router);
v1.use("/demo/coach", coachRouter);

// Admin bot simulation control
function requireAdminRole(roles = ["admin"]) {
  return async (req: any, res: any, next: any) => {
    if (!req.session?.userId) return res.status(401).json({ error: "Not logged in" });
    const user = await prisma.user.findUnique({
      where: { id: req.session.userId },
      select: { role: true },
    });
    if (!user || !roles.includes(user.role))
      return res.status(403).json({ error: "Admin access required" });
    next();
  };
}

v1.get("/admin/bot-status", requireAuth, requireAdminRole(["admin", "moderator"]), (_req, res) => {
  res.json(botsModule.getSimulationStatus());
});

v1.post("/admin/bot-stop", requireAuth, requireAdminRole(["admin"]), rateLimit({ windowMs: 60000, max: 10 }), (_req, res) => {
  botsModule.stopSimulation();
  res.json({ success: true, status: botsModule.getSimulationStatus() });
});

v1.post("/admin/bot-start", requireAuth, requireAdminRole(["admin"]), rateLimit({ windowMs: 60000, max: 10 }), (_req, res) => {
  botsModule.startSimulation();
  res.json({ success: true, status: botsModule.getSimulationStatus() });
});

// Mount both /api/v1 and /api for backward compatibility
app.use("/api/v1", v1);
app.use("/api", v1);

const pageCache = new Map<string, { html: string; time: number }>();
const PAGE_CACHE_TTL = 300_000; // 5 minutes
function serveCachedPage(pagePath: string, req: any, res: any) {
  const now = Date.now();
  const cached = pageCache.get(pagePath);
  if (cached && now - cached.time < PAGE_CACHE_TTL) {
    const modified = cached.html.replace(/__NONCE__/g, res.locals.nonce || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(modified));
    return res.end(modified);
  }
  try {
    const html = fs.readFileSync(pagePath, "utf-8");
    pageCache.set(pagePath, { html, time: now });
    const modified = html.replace(/__NONCE__/g, res.locals.nonce || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(modified));
    res.end(modified);
  } catch {
    res.status(500).send("Error loading page");
  }
}

app.get("/signals", (req, res) => {
  serveCachedPage(path.join(projectRoot, "pages", "signals.html"), req, res);
});

app.get("/bot-trading", (req, res) => {
  const fp = path.join(projectRoot, "pages", "bot-trading.html");
  try {
    const html = fs.readFileSync(fp, "utf-8");
    const modified = html.replace(/__NONCE__/g, res.locals.nonce || "");
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Content-Length", Buffer.byteLength(modified));
    res.end(modified);
  } catch {
    res.status(500).send("Error loading page");
  }
});

// ── Metrics endpoint (Prometheus) ──
app.get("/api/metrics", requireAuth, async (req, res) => {
  if (req.session?.role !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.send(await getMetrics());
    return;
  } catch (err) {
    res.status(500).send("Metrics error");
    return;
  }
});

// ── CSP violation report endpoint ──
app.post("/api/csp-violation", (req, res) => {
  if (req.body) logger.warn({ cspReport: req.body }, "CSP violation");
  res.status(204).end();
});

// ── Feature flags endpoint ──
app.get("/api/flags", async (_req, res) => {
  res.json(await getAllFlags());
});

// ── Hardened health check — validates DB read + write path ──
app.get("/api/health", async (req, res) => {
  let dbStatus = "connected";
  let dbWriteStatus = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = "error";
  }

  // Lightweight DB write check
  if (dbStatus === "connected") {
    try {
      await prisma.$executeRawUnsafe(
        `CREATE TABLE IF NOT EXISTS _health_check (id SERIAL PRIMARY KEY, ts TIMESTAMPTZ DEFAULT NOW())`
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO _health_check (ts) VALUES (NOW())`
      );
      await prisma.$executeRawUnsafe(
        `DELETE FROM _health_check WHERE ts < NOW() - INTERVAL '5 minutes'`
      );
    } catch {
      dbWriteStatus = "error";
    }
  }

  let mlReadyState = "not_ready";
  try {
    const isHealthy = await mlService.mlHealthy();
    if (isHealthy) mlReadyState = "ready";
  } catch { /* ignore */ }

  let redisStatus = "disconnected";
  if (redisClient && redisClient.isOpen && redisClient.isReady) {
    redisStatus = "connected";
  }

  const healthy = dbStatus === "connected" && dbWriteStatus === "ok";
  const statusCode = healthy ? 200 : 503;

  res.status(statusCode).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    database: dbStatus,
    database_write: dbWriteStatus,
    ml: mlReadyState,
    redis: redisStatus,
    uptime: process.uptime(),
  });
});

const server = http.createServer(app);
const io = new SocketIoServer(server, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

io.use((socket, next) => {
  sessionMiddleware(socket.request as any, {} as any, next as any);
});

const voiceRooms = new Map<string, Set<{ socketId: string; userId: number; username: string; role: string; muted: boolean }>>();
const MAX_ROOM_SIZE = 10;

// Socket rate limiting: max 30 events/sec per socket
const socketRateMap = new Map<string, number[]>();
function checkSocketRate(socketId: string): boolean {
  const now = Date.now();
  const timestamps = socketRateMap.get(socketId) || [];
  const recent = timestamps.filter(t => now - t < 1000);
  if (recent.length >= 30) return false;
  recent.push(now);
  socketRateMap.set(socketId, recent);
  return true;
}

io.on("connection", (socket) => {
  const session = (socket.request as any).session;
  const userId = session?.userId || null;
  let userRole = session?.role || "user";
  logger.info({ msg: "socket_connected", socketId: socket.id, userId });

  socket.use(([event], next) => {
    if (!checkSocketRate(socket.id)) {
      logger.warn({ msg: "socket_rate_limited", socketId: socket.id, event });
      return;
    }
    next();
  });

  // Join user-specific room for push notifications
  if (userId) {
    socket.join(`user:${userId}`);
  }

  socket.on("voice:join", (data: { room: string; username: string }, ack?: Function) => {
    if (!userId) { ack?.({ error: "Not authenticated" }); return; }
    const roomName = `voice:${data.room}`;
    const room = voiceRooms.get(data.room);
    if (room && room.size >= MAX_ROOM_SIZE) { ack?.({ error: "Room is full" }); return; }
    socket.join(roomName);
    if (!voiceRooms.has(data.room)) voiceRooms.set(data.room, new Set());
    const currentRoom = voiceRooms.get(data.room)!;
    const existing = [...currentRoom].find(u => u.userId === userId);
    if (existing) currentRoom.delete(existing);
    const userEntry = { socketId: socket.id, userId, username: data.username, role: userRole, muted: false };
    currentRoom.add(userEntry);
    const users = [...currentRoom].map(u => ({ userId: u.userId, username: u.username, role: u.role, socketId: u.socketId, muted: u.muted }));
    socket.emit("voice:room-users", { room: data.room, users });
    socket.to(roomName).emit("voice:user-joined", { userId, username: data.username, role: userRole, socketId: socket.id });
    ack?.({ ok: true, users });
  });

  socket.on("voice:leave", (data: { room: string }) => {
    if (!userId) return;
    const roomName = `voice:${data.room}`;
    socket.leave(roomName);
    const room = voiceRooms.get(data.room);
    if (room) {
      const userEntry = [...room].find(u => u.socketId === socket.id);
      if (userEntry) room.delete(userEntry);
      if (room.size === 0) voiceRooms.delete(data.room);
    }
    socket.to(roomName).emit("voice:user-left", { userId, socketId: socket.id });
  });

  socket.on("voice:admin-mute", (data: { room: string; targetSocketId: string; muted: boolean }) => {
    if (!userId || userRole !== "admin") return;
    // Refresh role from session in case it changed since connection
    userRole = session?.role || "user";
    if (userRole !== "admin") return;
    const room = voiceRooms.get(data.room);
    if (!room) return;
    const target = [...room].find(u => u.socketId === data.targetSocketId);
    if (!target) return;
    target.muted = data.muted;
    io.to(`voice:${data.room}`).emit("voice:user-muted", { userId: target.userId, socketId: data.targetSocketId, muted: data.muted, byAdmin: true });
  });

  socket.on("voice:admin-kick", (data: { room: string; targetSocketId: string }) => {
    if (!userId || userRole !== "admin") return;
    // Refresh role from session in case it changed since connection
    userRole = session?.role || "user";
    if (userRole !== "admin") return;
    const room = voiceRooms.get(data.room);
    if (!room) return;
    const target = [...room].find(u => u.socketId === data.targetSocketId);
    if (!target) return;
    room.delete(target);
    if (room.size === 0) voiceRooms.delete(data.room);
    io.to(`voice:${data.room}`).emit("voice:user-kicked", { userId: target.userId, socketId: data.targetSocketId });
    const targetSocket = io.sockets.sockets.get(data.targetSocketId);
    if (targetSocket) {
      targetSocket.leave(`voice:${data.room}`);
      targetSocket.emit("voice:you-were-kicked", { room: data.room });
    }
  });

  socket.on("signal:offer", (data: { to: string; offer: any }) => {
    io.to(data.to).emit("signal:offer", { from: socket.id, offer: data.offer });
  });

  socket.on("signal:answer", (data: { to: string; answer: any }) => {
    io.to(data.to).emit("signal:answer", { from: socket.id, answer: data.answer });
  });

  socket.on("signal:ice-candidate", (data: { to: string; candidate: any }) => {
    io.to(data.to).emit("signal:ice-candidate", { from: socket.id, candidate: data.candidate });
  });

  socket.on("voice:mute-toggle", (data: { room: string; muted: boolean }) => {
    if (!userId) return;
    const room = voiceRooms.get(data.room);
    if (room) {
      const userEntry = [...room].find(u => u.socketId === socket.id);
      if (userEntry) userEntry.muted = data.muted;
    }
    socket.to(`voice:${data.room}`).emit("voice:user-muted", { userId, socketId: socket.id, muted: data.muted });
  });

  socket.on("disconnect", () => {
    logger.info({ msg: "socket_disconnected", socketId: socket.id });
    socketRateMap.delete(socket.id);
    voiceRooms.forEach((users, roomName) => {
      const userEntry = [...users].find(u => u.socketId === socket.id);
      if (userEntry) {
        users.delete(userEntry);
        if (users.size === 0) voiceRooms.delete(roomName);
        socket.to(`voice:${roomName}`).emit("voice:user-left", { userId, socketId: socket.id, username: userEntry.username });
      }
    });
  });
});

// Start background monitors
startEventLoopMonitor();
if (process.env.NODE_ENV !== "test") {
  mlService.startMLService();
  initWebSocketService(io);
  startStockTickerStream(io);
  startAlertEngine(io);

  const RETRAIN_INTERVAL_MS = 24 * 60 * 60 * 1000;
  const RETRAIN_INITIAL_DELAY_MS = 5 * 60 * 1000;
  const RETRAIN_RETRY_BASE_MS = 15 * 60 * 1000;
  const RETRAIN_RETRY_MAX_MS = 6 * 60 * 60 * 1000;
  const RETRAIN_STATE_PATH = path.join(projectRoot, "ml_engine", "retrain_schedule.json");
  type RetrainScheduleState = {
    lastStartedAt?: number;
    lastCompletedAt?: number;
    nextRunAt?: number;
    consecutiveFailures: number;
    lastError?: string;
  };

  let retrainTimer: NodeJS.Timeout | null = null;
  let retrainInFlight = false;

  const loadRetrainState = (): RetrainScheduleState => {
    try {
      const raw = fs.readFileSync(RETRAIN_STATE_PATH, "utf8");
      const parsed = JSON.parse(raw) as Partial<RetrainScheduleState>;
      return {
        consecutiveFailures: 0,
        ...(parsed || {}),
      } as RetrainScheduleState;
    } catch {
      return { consecutiveFailures: 0 };
    }
  };

  const saveRetrainState = (state: RetrainScheduleState) => {
    try {
      fs.writeFileSync(RETRAIN_STATE_PATH, JSON.stringify(state, null, 2));
    } catch (err) {
      logger.warn({ err }, "Failed to persist retrain schedule state");
    }
  };

  const getTrainingStatusSnapshot = () => {
    const statusPath = path.join(projectRoot, "ml_engine", "training_status.json");
    try {
      const raw = fs.readFileSync(statusPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  const isTrainingInProgress = () => {
    const status = getTrainingStatusSnapshot();
    if (!status?.is_training) return false;
    if (status.pid) {
      try {
        process.kill(status.pid, 0);
        const tooOld = status.started_at && Date.now() - status.started_at > 4 * 60 * 60 * 1000;
        return !tooOld;
      } catch {
        return false;
      }
    }
    return false;
  };

  const scheduleNextRetrain = (delayMs: number) => {
    if (retrainTimer) clearTimeout(retrainTimer);
    const state = loadRetrainState();
    state.nextRunAt = Date.now() + delayMs;
    saveRetrainState(state);
    retrainTimer = setTimeout(() => {
      void runScheduledRetrain();
    }, delayMs);
  };

  const runScheduledRetrain = async () => {
    if (retrainInFlight) {
      logger.info("Retraining already in progress — deferring the next run by 30 minutes");
      scheduleNextRetrain(30 * 60 * 1000);
      return;
    }

    if (isTrainingInProgress()) {
      logger.info("Training status shows an active run — deferring the next scheduled retrain");
      scheduleNextRetrain(30 * 60 * 1000);
      return;
    }

    const state = loadRetrainState();
    const now = Date.now();
    state.lastStartedAt = now;
    saveRetrainState(state);
    retrainInFlight = true;

    try {
      logger.info({ msg: "retrain_start" }, "Starting scheduled ML retraining...");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 180_000);
      const scheduledPayload = buildScheduledRetrainPayload();
      const response = await fetch(`http://127.0.0.1:${env.PORT}/api/ml/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scheduledPayload),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || `HTTP ${response.status}`);
      }

      const nextState = loadRetrainState();
      nextState.lastCompletedAt = Date.now();
      nextState.consecutiveFailures = 0;
      nextState.lastError = undefined;
      saveRetrainState(nextState);
      logger.info({ result: payload }, "Scheduled retrain complete");
      try {
        await fetch(`http://127.0.0.1:${env.ML_PORT}/api/ml/reload`, { method: "POST", signal: AbortSignal.timeout(5000) });
        logger.info("ML model reloaded after retrain");
      } catch (e) {
        logger.warn({ err: e }, "ML model reload failed after retrain — old model still active");
      }
      scheduleNextRetrain(RETRAIN_INTERVAL_MS);
    } catch (err) {
      const nextState = loadRetrainState();
      nextState.consecutiveFailures = (nextState.consecutiveFailures || 0) + 1;
      nextState.lastError = err instanceof Error ? err.message : String(err);
      saveRetrainState(nextState);

      const backoffMs = Math.min(
        RETRAIN_RETRY_BASE_MS * 2 ** Math.max(0, nextState.consecutiveFailures - 1),
        RETRAIN_RETRY_MAX_MS,
      );
      logger.warn({ err, backoffMs }, "Scheduled retrain failed — retrying with backoff");
      scheduleNextRetrain(backoffMs);
    } finally {
      retrainInFlight = false;
    }
  };

  const startScheduledRetraining = () => {
    const state = loadRetrainState();
    const now = Date.now();
    let delayMs = RETRAIN_INITIAL_DELAY_MS;

    if (state.nextRunAt && state.nextRunAt > now) {
      delayMs = state.nextRunAt - now;
    } else if (state.lastCompletedAt && state.lastCompletedAt + RETRAIN_INTERVAL_MS > now) {
      delayMs = state.lastCompletedAt + RETRAIN_INTERVAL_MS - now;
    } else if (state.lastStartedAt && state.lastStartedAt + RETRAIN_INTERVAL_MS <= now) {
      delayMs = 0;
    } else if (state.consecutiveFailures > 0) {
      delayMs = Math.min(
        RETRAIN_RETRY_BASE_MS * 2 ** Math.max(0, state.consecutiveFailures - 1),
        RETRAIN_RETRY_MAX_MS,
      );
    }

    scheduleNextRetrain(delayMs);
  };

  startScheduledRetraining();
}

if (env.SENTRY_DSN) {
  Sentry.setupExpressErrorHandler(app);
  app.get("/api/sentry-test", (req, res) => {
    Sentry.captureException(new Error("Sentry manual test — check Issues tab"));
    Sentry.flush(2000).then(() => res.json({ sent: true }));
  });
}

app.use(errorHandler);

const PORT = env.PORT;
if (process.env.NODE_ENV !== "test" && !process.argv.some((arg) => arg.includes("test"))) {
  try {
    await prisma.$queryRaw`SELECT 1 FROM "users" LIMIT 1`;
  } catch (err) {
    console.error("FATAL: Prisma migrations have not been applied or the database is not accessible.");
    console.error("Action: Run 'npx prisma migrate deploy' against DATABASE_URL.");
    console.error("Details:", err);
    process.exit(1);
  }

  const srv = server.listen(PORT, "0.0.0.0", () => {
    console.log(`StockWise running at http://localhost:${PORT}`);
    console.log(`News sources: NEWSAPI_KEY=${env.NEWSAPI_KEY ? "present" : "missing"}, CRYPTOCOMPARE_API_KEY=${env.CRYPTOCOMPARE_API_KEY ? "present" : "missing"}`);
    logger.info({ msg: "server_started", mode: env.NODE_ENV || "development", port: PORT });
  });

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down gracefully...");
    botsModule.stopSimulation();
    srv.close(() => {
      prisma.$disconnect();
      process.exit(0);
    });
    setTimeout(() => {
      logger.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

export { app, prisma as db, server, io };