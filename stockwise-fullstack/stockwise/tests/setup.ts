import { execSync } from "child_process";

process.env.NODE_ENV = "test";

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/stockwise_test?schema=public";
}

if (!process.env.SESSION_SECRET) {
  process.env.SESSION_SECRET = "test-session-secret-thats-minimum-32-chars!!";
}

if (!process.env.ENCRYPTION_MASTER_KEY) {
  process.env.ENCRYPTION_MASTER_KEY = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
}

if (!process.env.COINGECKO_API_KEY) {
  process.env.COINGECKO_API_KEY = "CG-test-dummy-key";
}

if (!process.env.GMAIL_USER) {
  process.env.GMAIL_USER = "test@stockwise.test";
}

if (!process.env.GMAIL_PASS) {
  process.env.GMAIL_PASS = "test-pass";
}

try {
  execSync("npx prisma migrate deploy", {
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    stdio: "pipe",
    timeout: 30000,
  });
} catch (e) {
  console.warn("DB migration skipped (may already be applied):", e.message);
}
