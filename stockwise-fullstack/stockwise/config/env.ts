import dotenv from "dotenv";
import { z } from "zod";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dotenvPath = path.join(__dirname, "..", ".env");

dotenv.config({ path: dotenvPath });

const envSchema = z.object({
   SESSION_SECRET: z
    .string()
    .min(32, "SESSION_SECRET should be at least 32 characters")
    .optional()
    .default("ci-test-secret-at-least-32-chars-long-for-testing"),
   GMAIL_USER: z.string().optional().default(""),
   GMAIL_PASS: z.string().optional().default(""),
   COINGECKO_API_KEY: z.string().optional().default(""),
   ML_PORT: z.coerce.number().default(8100),
   NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
   FINNHUB_API_KEY: z.string().optional().default(""),
   PORT: z.coerce.number().default(3000),
   ML_BASE_URL: z.string().optional().default(""),
   DATABASE_URL: z.string().optional().default(""),
   REDIS_URL: z.string().url("REDIS_URL must be a valid connection URL").default("redis://localhost:6379"),
   ENCRYPTION_MASTER_KEY: z.string().optional().default("0".repeat(64)),
   SENTRY_DSN: z.string().optional().default(""),
   CRYPTOCOMPARE_API_KEY: z.string().optional().default(""),
   DOMAIN: z.string().optional().default(""),
   DISCORD_WEBHOOK_URL: z.string().optional().default(""),
   TELEGRAM_BOT_TOKEN: z.string().optional().default(""),
   TELEGRAM_CHAT_ID: z.string().optional().default(""),
   TRADINGVIEW_PASSPHRASE: z.string().optional().default("stockwise_secret"),
   BACKUP_S3_BUCKET: z.string().optional().default(""),
   BACKUP_S3_ENDPOINT: z.string().optional().default(""),
   BACKUP_S3_ACCESS_KEY: z.string().optional().default(""),
   BACKUP_S3_SECRET_KEY: z.string().optional().default(""),
   VAULT_ADDR: z.string().optional().default(""),
   VAULT_TOKEN: z.string().optional().default(""),
   MLFLOW_TRACKING_URI: z.string().optional().default(""),
   NEWSAPI_KEY: z.string().optional().default(""),
   OPENAI_API_KEY: z.string().optional().default(""),
   GEMINI_API_KEY: z.string().optional().default(""),
   GITHUB_TOKEN: z.string().optional().default(""),
});

export const env = envSchema.parse(process.env);
