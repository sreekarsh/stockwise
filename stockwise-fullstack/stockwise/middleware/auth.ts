import { redisClient } from "../services/redis.js";
import type { Request, Response, NextFunction } from "express";

const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const memoryRateLimits = new Map();
const memoryLoginFailures = new Map();

// Periodic cleanup of in-memory rate limit and login failure maps (every 5 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [key, record] of memoryRateLimits) {
    if (now > record.resetTime) memoryRateLimits.delete(key);
  }
  for (const [ip, record] of memoryLoginFailures) {
    if (record.lockedUntil > 0 && now > record.lockedUntil) {
      memoryLoginFailures.delete(ip);
    }
  }
}, 300_000).unref();

/**
 * Custom rate limiter middleware.
 * Uses Redis if connected, otherwise falls back to a simple in-memory map.
 */
function rateLimit(options: { windowMs: number; max: number } = { windowMs: 60000, max: 100 }) {
  return async (req: Request, res: Response, next: NextFunction) => {
    let raw = req.ip || req.socket?.remoteAddress || "unknown";
    if (raw.startsWith("::ffff:")) raw = raw.slice(7);
    if (raw === "::1") raw = "127.0.0.1";
    const ip = raw;
    const key = `rate_limit:${ip}:${req.path}`;
    const now = Date.now();

    const isRedisConnected = redisClient && redisClient.isOpen && redisClient.isReady;

    if (isRedisConnected) {
      try {
        const count = await redisClient.incr(key);
        if (count === 1) {
          await redisClient.expire(key, Math.ceil(options.windowMs / 1000));
        }
        if (count > options.max) {
          return res
            .status(429)
            .json({ error: "Too many requests. Please slow down." });
        }
        return next();
      } catch (err) {
        console.error("Redis rate limit error, falling back to memory:", err);
      }
    }

    // In-memory fallback
    let record = memoryRateLimits.get(key);
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + options.windowMs };
      memoryRateLimits.set(key, record);
      return next();
    }

    record.count += 1;
    if (record.count > options.max) {
      return res
        .status(429)
        .json({ error: "Too many requests. Please slow down." });
    }
    next();
  };
}

/**
 * Check if the request IP is locked out due to too many failed login attempts.
 */
async function checkLockout(req: Request, res: Response, next: NextFunction) {
  if (process.env.NODE_ENV === "test") return next();
  let raw = req.ip || req.socket?.remoteAddress || "unknown";
  if (raw.startsWith("::ffff:")) raw = raw.slice(7);
  if (raw === "::1") raw = "127.0.0.1";
  const ip = raw;
  const now = Date.now();
  const key = `login_lockout:${ip}`;

  const isRedisConnected = redisClient && redisClient.isOpen && redisClient.isReady;
  let attempts = 0;
  let lockedUntil = 0;

  if (isRedisConnected) {
    try {
      const row = await redisClient.hGetAll(key);
      if (row && row.attempts) {
        attempts = parseInt(row.attempts, 10);
        lockedUntil = parseInt(row.lockedUntil || "0", 10);
      }
    } catch (err) {
      console.error("Redis lockout check error, falling back to memory:", err);
    }
  } else {
    const row = memoryLoginFailures.get(ip);
    if (row) {
      attempts = row.attempts;
      lockedUntil = row.lockedUntil;
    }
  }

  if (lockedUntil > now) {
    const targetPaths = [
      "/login",
      "/register",
      "/forgot-password",
      "/api/login",
      "/api/register",
      "/api/forgot-password",
    ];
    if (targetPaths.includes(req.path)) {
      const minutesLeft = Math.ceil((lockedUntil - now) / 60000);
      return res.status(403).json({
        error: `Too many failed attempts. Locked out. Please try again in ${minutesLeft} minutes.`,
      });
    }
  }
  next();
}

/**
 * Record a failed login attempt for the request IP, locking it out if necessary.
 */
async function recordFailedAttempt(ip: string) {
  const now = Date.now();
  const key = `login_lockout:${ip}`;
  const isRedisConnected = redisClient && redisClient.isOpen && redisClient.isReady;

  let attempts = 0;
  let lockedUntil = 0;

  if (isRedisConnected) {
    try {
      const row = await redisClient.hGetAll(key);
      if (row && row.attempts) {
        attempts = parseInt(row.attempts, 10);
        lockedUntil = parseInt(row.lockedUntil || "0", 10);
      }

      if (lockedUntil > 0 && now > lockedUntil) {
        attempts = 1;
        lockedUntil = 0;
      } else {
        attempts += 1;
        if (attempts >= MAX_FAILED_ATTEMPTS) {
          lockedUntil = now + LOCKOUT_MINUTES * 60 * 1000;
        }
      }

      await redisClient.hSet(key, {
        attempts: attempts.toString(),
        lockedUntil: lockedUntil.toString(),
      });
      await redisClient.expire(key, 3600); // Expire lockout track after 1 hour
      return;
    } catch (err) {
      console.error("Redis record failed attempt error, falling back to memory:", err);
    }
  }

  // In-memory fallback
  let row = memoryLoginFailures.get(ip);
  if (!row) {
    row = { attempts: 1, lockedUntil: 0 };
  } else {
    if (row.lockedUntil > 0 && now > row.lockedUntil) {
      row.attempts = 1;
      row.lockedUntil = 0;
    } else {
      row.attempts += 1;
      if (row.attempts >= MAX_FAILED_ATTEMPTS) {
        row.lockedUntil = now + LOCKOUT_MINUTES * 60 * 1000;
      }
    }
  }
  memoryLoginFailures.set(ip, row);
}

/**
 * Reset failed login attempts for the request IP upon successful login.
 */
async function resetFailedAttempts(ip: string) {
  const key = `login_lockout:${ip}`;
  const isRedisConnected = redisClient && redisClient.isOpen && redisClient.isReady;

  if (isRedisConnected) {
    try {
      await redisClient.del(key);
      return;
    } catch (err) {
      console.error("Redis reset failed attempts error, falling back to memory:", err);
    }
  }

  memoryLoginFailures.delete(ip);
}

/**
 * Require authentication middleware.
 */
const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }
  return next();
};

export {
  rateLimit,
  requireAuth,
  checkLockout,
  recordFailedAttempt,
  resetFailedAttempts,
};
