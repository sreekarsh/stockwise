import express from "express";
import prisma from "../services/db.js";
import logger from "../services/logger.js";
import { alertCreateSchema, webhookSchema } from "../schemas/alerts.ts";
import { sendEmail } from "../services/mailService.js";

const router = express.Router();

/**
 * Dispatch notification messages to Discord / Telegram / Email if configured.
 */
export async function sendNotification(message: string, userId?: number | null) {
  logger.info({ message }, "Notification dispatch");

  const discordUrl = process.env.DISCORD_WEBHOOK_URL;
  if (discordUrl) {
    try {
      await fetch(discordUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
      });
    } catch (err: any) {
      logger.warn({ err }, "Discord notification failed");
    }
  }

  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (tgToken && tgChatId) {
    try {
      const url = `https://api.telegram.org/bot${tgToken}/sendMessage`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: tgChatId, text: message }),
      });
    } catch (err: any) {
      logger.warn({ err }, "Telegram notification failed");
    }
  }

  if (userId) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true, username: true },
      });
      if (user?.email) {
        const cleanMessage = message.replace(/\[Alerts\]\s*/, "").replace(/ by .+$/, "");
        await sendEmail(
          user.email,
          "StockWise Alert Triggered",
          `<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:24px;background:#0b0f1a;color:#e0e0e0;border-radius:12px;border:1px solid #1e2a3a">
            <h2 style="color:#00e5a0;margin:0 0 8px">🔔 Alert Triggered</h2>
            <p style="color:#8892a4;margin:0 0 20px">Hi ${user.username},</p>
            <div style="background:#111927;border-radius:8px;padding:16px">
              <p style="margin:0;color:#e0e0e0;font-size:1rem">${cleanMessage}</p>
            </div>
            <p style="color:#8892a4;font-size:0.8rem;margin-top:20px">Log in to StockWise to manage your alerts.</p>
          </div>`,
        );
      }
    } catch (err: any) {
      logger.warn({ err }, "Email notification failed");
    }
  }
}

// POST /api/webhooks/tradingview
router.post("/webhooks/tradingview", express.urlencoded({ extended: true }), express.json(), async (req, res) => {
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  const parsed = webhookSchema.safeParse(body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid webhook payload", details: parsed.error.issues });
  }
  const { passphrase, symbol, action, price, msg } = parsed.data;

  const expectedPassphrase = process.env.TRADINGVIEW_PASSPHRASE || "";
  if (!expectedPassphrase) logger.warn("TRADINGVIEW_PASSPHRASE not set — webhook auth disabled");
  if (passphrase !== expectedPassphrase) {
    return res.status(401).json({ error: "Unauthorized passphrase" });
  }

  const alertMessage = `🚨 [TradingView Alert] ${symbol.toUpperCase()} ${action.toUpperCase()} trigger met at $${price}. Note: ${msg || "No extra message"}`;
  await sendNotification(alertMessage);

  return res.json({ success: true, message: "TradingView alert webhook processed successfully." });
});

// GET /api/alerts
router.get("/alerts", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const alerts = await prisma.alert.findMany({
      where: { user_id: req.session.userId, triggered: 0 },
      orderBy: { created_at: "desc" },
    });
    return res.json(alerts);
  } catch (err: any) {
    logger.error({ err }, "GET /api/alerts database error");
    return res.status(500).json({ error: "Database query error" });
  }
});

// POST /api/alerts
router.post("/alerts", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const parsed = alertCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid alert data", details: parsed.error.issues });
  }
  const { symbol, target_price, direction } = parsed.data;

  try {
    const alert = await prisma.alert.create({
      data: {
        user_id: req.session.userId,
        symbol: symbol.toUpperCase(),
        target_price,
        direction,
        triggered: 0,
      },
    });
    return res.json({ success: true, alert });
  } catch (err) {
    logger.error({ err }, "Alert create error");
    return res.status(500).json({ error: "Database insert error" });
  }
});

// GET /api/alerts/history — recently triggered alerts for the user
router.get("/alerts/history", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  try {
    const alerts = await prisma.alert.findMany({
      where: { user_id: req.session.userId, triggered: 1 },
      orderBy: { created_at: "desc" },
      take: 20,
    });
    return res.json(alerts);
  } catch (err: any) {
    logger.error({ err }, "GET /api/alerts/history error");
    return res.status(500).json({ error: "Database query error" });
  }
});

// DELETE /api/alerts/:id
router.delete("/alerts/:id", async (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: "Not logged in" });
  }

  const alertId = parseInt(req.params.id, 10);
  if (isNaN(alertId)) {
    return res.status(400).json({ error: "Invalid alert ID" });
  }

  try {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
    });

    if (!alert || alert.user_id !== req.session.userId) {
      return res.status(404).json({ error: "Alert not found or unauthorized" });
    }

    await prisma.alert.delete({
      where: { id: alertId },
    });
    return res.json({ success: true });
  } catch (err: any) {
    logger.error({ err }, "DELETE /api/alerts database error");
    return res.status(500).json({ error: "Database delete error" });
  }
});

export default router;
