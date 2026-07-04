import { createClient } from "redis";
import { env } from "../config/env.js";
import { execSync } from "child_process";

function resolveRedisUrl() {
  const url = new URL(env.REDIS_URL || "redis://localhost:6379");
  const host = url.hostname;

  if ((host === "localhost" || host === "127.0.0.1") && process.platform === "win32") {
    try {
      const wslIp = execSync(
        'wsl -d Ubuntu bash -c "hostname -I | cut -d\' \' -f1"',
        { timeout: 3000, encoding: "utf8" }
      ).trim();
      if (wslIp) {
        url.hostname = wslIp;
      }
    } catch {
      // WSL not available, keep original URL
    }
  }

  return url.toString();
}

let redisClient: any = null;
let _connPromise: Promise<any> | null = null;

export async function waitForRedis() {
  if (!redisClient) return null;
  if (redisClient.isReady) return redisClient;
  if (_connPromise) {
    try {
      await _connPromise;
      if (redisClient?.isReady) return redisClient;
    } catch {
      // connection failed
    }
  }
  return null;
}

if (env.REDIS_URL) {
  const resolvedUrl = resolveRedisUrl();

  redisClient = createClient({
    url: resolvedUrl,
    socket: {
      connectTimeout: 5000,
      reconnectStrategy: (retries) => {
        if (retries > 5) {
          console.warn("Redis reconnect attempts exceeded.");
          return new Error("Redis connection lost");
        }
        return Math.min(retries * 500, 2000);
      }
    }
  });

  redisClient.on("error", (err: Error) => {
    const msg = err?.message || "";
    const ignore = ["ECONNREFUSED", "Socket closed unexpectedly", "The client is closed", "AggregateError"];
    if (msg && !ignore.some((s) => msg.includes(s))) {
      console.error("Redis client error:", msg);
    }
  });

  redisClient.on("connect", () => {
    console.log("Redis client connecting...");
  });

  redisClient.on("ready", () => {
    console.log("Redis client ready and connected.");
  });

  redisClient.on("end", () => {
    console.warn("Redis connection closed. Will attempt reconnect via reconnectStrategy.");
  });

  _connPromise = redisClient.connect().catch((err: Error) => {
    const msg = err?.message || "";
    const ignore = ["ECONNREFUSED", "AggregateError"];
    if (msg && !ignore.some((s) => msg.includes(s))) {
      console.error("Failed to connect to Redis:", msg);
    }
    redisClient = null;
  });
}

export function __setRedisClient(client: any) {
  redisClient = client;
}

export { redisClient };
export default redisClient;
