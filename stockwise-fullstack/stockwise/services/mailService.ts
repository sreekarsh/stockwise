import nodemailer from "nodemailer";
import { env } from "../config/env.js";

const OWNER_EMAIL = "sreekarsh44@gmail.com";

function createMailTransport() {
  if (!env.GMAIL_USER || !env.GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: env.GMAIL_USER, pass: env.GMAIL_PASS },
  });
}

async function sendEmail(to: string, subject: string, html: string) {
  const transport = createMailTransport();
  if (!transport) {
    console.log("\n[EMAIL NOT SENT — SMTP not configured]");
    return false;
  }
  try {
    await transport.sendMail({
      from: env.GMAIL_USER,
      to,
      subject,
      html,
    });
    console.log("Email sent to:", to);
    return true;
  } catch (e: any) {
    console.error("Email send failed:", e.message);
    return false;
  }
}

async function sendOwnerEmail(subject: string, html: string) {
  return sendEmail(OWNER_EMAIL, subject, html);
}

export { OWNER_EMAIL, sendOwnerEmail, sendEmail };
export default { OWNER_EMAIL, sendOwnerEmail, sendEmail };
