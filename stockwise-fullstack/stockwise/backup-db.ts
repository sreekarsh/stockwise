import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import dotenv from "dotenv";
dotenv.config({ path: path.join(__dirname, ".env") });

const BACKUP_DIR = path.join(__dirname, "backups");
const dbUrl = process.env.DATABASE_URL || "";
const DB_NAME = dbUrl.includes("/") ? dbUrl.split("/").pop()?.split("?")[0] || "stockwise" : "stockwise";

if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(BACKUP_DIR, `${DB_NAME}-${timestamp}.sql`);
const compressedFile = backupFile + ".gz";

try {
  execSync(`pg_dump "${dbUrl}" > "${backupFile}"`, { timeout: 120000, stdio: "pipe" });
  execSync(`gzip -f "${backupFile}"`, { timeout: 60000, stdio: "pipe" });
  console.log(`Backup created: ${compressedFile}`);

  // Upload to S3-compatible storage if configured
  const s3Bucket = process.env.BACKUP_S3_BUCKET;
  const s3Endpoint = process.env.BACKUP_S3_ENDPOINT;
  const s3Key = process.env.BACKUP_S3_ACCESS_KEY;
  const s3Secret = process.env.BACKUP_S3_SECRET_KEY;

  if (s3Bucket && s3Endpoint && s3Key && s3Secret) {
    try {
      const fileName = path.basename(compressedFile);
      const date = new Date().toUTCString();
      const stringToSign = `PUT\n\napplication/gzip\n${date}\n/${s3Bucket}/${fileName}`;
      const signature = execSync(
        `echo -n "${stringToSign}" | openssl sha1 -hmac "${s3Secret}" -binary | base64`,
        { encoding: "utf-8" }
      ).trim();

      execSync(
        `curl -s -X PUT -T "${compressedFile}" ` +
        `-H "Host: ${s3Endpoint}" ` +
        `-H "Date: ${date}" ` +
        `-H "Content-Type: application/gzip" ` +
        `-H "Authorization: AWS ${s3Key}:${signature}" ` +
        `"https://${s3Endpoint}/${s3Bucket}/${fileName}"`,
        { timeout: 120000, stdio: "pipe" }
      );
      console.log(`Backup uploaded to S3: ${s3Bucket}/${fileName}`);
    } catch (s3Err: any) {
      console.error("S3 upload failed (non-fatal):", s3Err.message);
    }
  } else {
    console.log("S3 not configured — backup kept locally only");
  }

  // Keep only the 7 most recent local backups
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((f) => f.startsWith(`${DB_NAME}-`) && f.endsWith(".sql.gz"))
    .sort()
    .reverse();

  for (const oldFile of files.slice(7)) {
    fs.unlinkSync(path.join(BACKUP_DIR, oldFile));
    console.log(`Removed old backup: ${oldFile}`);
  }
} catch (err: any) {
  console.error("Backup failed:", err.message);
  process.exit(1);
}
