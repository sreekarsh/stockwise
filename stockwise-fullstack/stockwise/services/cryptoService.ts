import crypto from "crypto";
import { env } from "../config/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
if (!env.ENCRYPTION_MASTER_KEY || Buffer.from(env.ENCRYPTION_MASTER_KEY, "hex").length !== 32) {
  throw new Error(
    "ENCRYPTION_MASTER_KEY must be a 64-character hex string. " +
    "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  );
}
const KEY_BUFFER = Buffer.from(env.ENCRYPTION_MASTER_KEY, "hex");

/**
 * Encrypt plain text using AES-256-GCM.
 * @param {string} text - The raw text to encrypt.
 * @returns {string} The formatted ciphertext containing IV and auth tag.
 */
export function encrypt(text: string) {
  if (!text) return "";
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY_BUFFER, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypt cipher text using AES-256-GCM.
 * @param {string} cipherText - The formatted ciphertext.
 * @returns {string} The decrypted plain text.
 */
export function decrypt(cipherText: string) {
  if (!cipherText) return "";
  const parts = cipherText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid ciphertext format for decryption");
  }
  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const encryptedText = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, KEY_BUFFER, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encryptedText, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}

export default {
  encrypt,
  decrypt,
};
