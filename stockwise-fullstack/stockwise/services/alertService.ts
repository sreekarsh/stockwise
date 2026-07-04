import prisma from "./db.js";
import { latestPrices } from "./websocketService.js";

let checkInterval: any = null;
let alertIo: any = null;

export function normalizeSymbol(sym: string) {
  return sym.toUpperCase().replace(/USDT$/, "");
}

export async function checkAlerts() {
  try {
    const alerts = await prisma.alert.findMany({
      where: { triggered: 0 },
      include: { user: { select: { username: true } } },
    });

    if (!alerts.length) return;

    const priceSymbols = [...new Set(alerts.map((a) => normalizeSymbol(a.symbol)))];
    const prices: Record<string, number> = {};

    for (const sym of priceSymbols) {
      const wsPrice = latestPrices[sym];
      if (wsPrice) {
        prices[sym] = wsPrice;
      }
    }

    for (const alert of alerts) {
      const sym = normalizeSymbol(alert.symbol);
      const current = prices[sym];
      if (!current) continue;

      const target = alert.target_price;
      const triggered =
        (alert.direction === "above" && current >= target) ||
        (alert.direction === "below" && current <= target);

      if (triggered) {
        await prisma.alert.update({
          where: { id: alert.id },
          data: { triggered: 1 },
        });
        const notifyMsg = `[Alerts] Triggered: ${alert.symbol} ${alert.direction} $${target} (current: $${current}) by ${alert.user.username}`;
        console.log(notifyMsg);
        const { sendNotification } = await import("../routes/alerts.js");
        await sendNotification(notifyMsg, alert.user_id ?? undefined);

        // Socket.io push to the specific user
        if (alertIo) {
          const userRoom = `user:${alert.user_id}`;
          alertIo.to(userRoom).emit("alertTriggered", {
            id: alert.id,
            symbol: alert.symbol,
            direction: alert.direction,
            target_price: target,
            current_price: current,
            triggered_at: new Date().toISOString(),
          });
        }
      }
    }
  } catch (err: any) {
    console.error("[Alerts] Check error:", err.message);
  }
}

export function startAlertEngine(io?: any) {
  if (checkInterval) return;
  if (io) alertIo = io;
  console.log("[Alerts] Engine started (checking every 60s)");
  checkAlerts();
  checkInterval = setInterval(checkAlerts, 60000);
}

export function stopAlertEngine() {
  if (checkInterval) {
    clearInterval(checkInterval);
    checkInterval = null;
  }
}
