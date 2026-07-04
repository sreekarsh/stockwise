import { redisClient } from "./redis.js";

const FLAG_TTL = 60;

const DEFAULT_FLAGS: Record<string, boolean> = {
  "v2-bot-strategies": false,
  "new-portfolio-analyzer": false,
  "ml-canary": false,
  "community-chat-rooms": false,
  "alerts-email-digest": true,
};

async function getFlag(key: string): Promise<boolean> {
  if (!redisClient?.isReady) {
    return DEFAULT_FLAGS[key] ?? false;
  }

  try {
    const raw = await redisClient.get(`flag:${key}`);
    if (raw === null) {
      const val = DEFAULT_FLAGS[key] ?? false;
      await redisClient.setEx(`flag:${key}`, FLAG_TTL, val ? "1" : "0");
      return val;
    }
    return raw === "1";
  } catch {
    return DEFAULT_FLAGS[key] ?? false;
  }
}

async function setFlag(key: string, value: boolean): Promise<void> {
  if (!redisClient?.isReady) return;

  try {
    await redisClient.setEx(`flag:${key}`, FLAG_TTL, value ? "1" : "0");
  } catch {
    /* silently fail — flags are non-critical */
  }
}

async function getAllFlags(): Promise<Record<string, boolean>> {
  const result: Record<string, boolean> = { ...DEFAULT_FLAGS };

  if (redisClient?.isReady) {
    try {
      const keys = await redisClient.keys("flag:*");
      if (keys.length) {
        const values = await redisClient.mGet(keys);
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i].replace("flag:", "");
          result[k] = values[i] === "1";
        }
      }
    } catch {
      /* use defaults */
    }
  }

  return result;
}

export { getFlag, setFlag, getAllFlags };
