import prisma from "./db.js";
import { TradeSignal, TradeResult } from "../types/bots.js";

const MAX_PURCHASE_VALUE = 800.0;
const BALANCE_FRACTION = 0.15;
const MIN_TRADE_VALUE = 10.0;

export async function getDemoAccount(userId: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { demo_balance: true, trader_xp: true, trader_level: true },
  });
  if (!user) return null;
  return {
    balance: user.demo_balance ?? 10000.0,
    xp: user.trader_xp ?? 0,
    level: user.trader_level ?? "Novice",
  };
}

export async function getDemoPortfolio(userId: number) {
  return prisma.demoPortfolio.findMany({
    where: { user_id: userId, quantity: { gt: 0 } },
  });
}

export async function getHolding(userId: number, symbol: string) {
  return prisma.demoPortfolio.findUnique({
    where: {
      user_id_symbol: { user_id: userId, symbol },
    },
  });
}

export async function executeManualTrade(
  userId: number,
  symbol: string,
  type: TradeSignal,
  quantity: number,
  price: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { demo_balance: true },
    });
    if (!user) throw new Error("User not found");

    const totalCost = quantity * price;

    if (type === TradeSignal.BUY) {
      if (user.demo_balance < totalCost) {
        throw new Error("Insufficient demo balance");
      }
      await tx.user.update({
        where: { id: userId },
        data: { demo_balance: { decrement: totalCost } },
      });

      const existing = await tx.demoPortfolio.findUnique({
        where: { user_id_symbol: { user_id: userId, symbol } },
      });
      if (existing) {
        const newQty = existing.quantity + quantity;
        const newAvg = (existing.avg_buy_price * existing.quantity + totalCost) / newQty;
        await tx.demoPortfolio.update({
          where: { id: existing.id },
          data: { quantity: newQty, avg_buy_price: newAvg },
        });
      } else {
        await tx.demoPortfolio.create({
          data: { user_id: userId, symbol, name: symbol, quantity, avg_buy_price: price },
        });
      }
    } else {
      const existing = await tx.demoPortfolio.findUnique({
        where: { user_id_symbol: { user_id: userId, symbol } },
      });
      if (!existing || existing.quantity < quantity) {
        throw new Error("Insufficient asset balance to sell");
      }
      await tx.user.update({
        where: { id: userId },
        data: { demo_balance: { increment: totalCost } },
      });

      const newQty = existing.quantity - quantity;
      if (newQty <= 0.00001) {
        await tx.demoPortfolio.delete({ where: { id: existing.id } });
      } else {
        await tx.demoPortfolio.update({
          where: { id: existing.id },
          data: { quantity: newQty },
        });
      }
    }

    await tx.demoTrade.create({
      data: {
        user_id: userId,
        symbol,
        type: type.valueOf(),
        quantity,
        price,
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: { trader_xp: { increment: 10 } },
    });
  });
}

export async function executeBotBuy(
  userId: number,
  symbol: string,
  botId: number,
  currentPrice: number,
  triggerMessage: string,
): Promise<void> {
  try {
    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { demo_balance: true },
      });
      if (!user) return { skipped: true };

      const purchaseValue = Math.min(user.demo_balance * BALANCE_FRACTION, MAX_PURCHASE_VALUE);
      if (purchaseValue < MIN_TRADE_VALUE) {
        return { skipped: true, balance: user.demo_balance };
      }

      const qtyToBuy = purchaseValue / currentPrice;

      await tx.user.update({
        where: { id: userId },
        data: { demo_balance: { decrement: purchaseValue } },
      });

      const existing = await tx.demoPortfolio.findUnique({
        where: { user_id_symbol: { user_id: userId, symbol } },
      });
      if (existing) {
        const newQty = existing.quantity + qtyToBuy;
        const newAvg = (existing.avg_buy_price * existing.quantity + purchaseValue) / newQty;
        await tx.demoPortfolio.update({
          where: { id: existing.id },
          data: { quantity: newQty, avg_buy_price: newAvg },
        });
      } else {
        await tx.demoPortfolio.create({
          data: { user_id: userId, symbol, name: symbol, quantity: qtyToBuy, avg_buy_price: currentPrice },
        });
      }

      await tx.demoTrade.create({
        data: { user_id: userId, symbol, type: "BUY", quantity: qtyToBuy, price: currentPrice },
      });

      return { skipped: false, purchaseValue, qtyToBuy };
    });

    if (result.skipped) {
      await prisma.demoBotLog.create({
        data: {
          bot_id: botId,
          message: `\u26A0\uFE0F SKIPPED: ${triggerMessage} Insufficient balance ($${(result.balance ?? 0).toFixed(2)}).`,
        },
      });
      return;
    }

    await prisma.demoBotLog.create({
      data: {
        bot_id: botId,
        message: `\uD83D\uDFE2 EXECUTE: ${triggerMessage} Bought ${(result.qtyToBuy ?? 0).toFixed(5)} ${symbol} at $${currentPrice.toLocaleString()} ($${(result.purchaseValue ?? 0).toFixed(2)} USDT).`,
      },
    });
  } catch (e) {
    console.error(`Bot BUY error for bot ${botId}:`, e);
  }
}

export async function executeBotSell(
  userId: number,
  symbol: string,
  botId: number,
  currentPrice: number,
  triggerMessage: string,
  strategy: string,
  qtyOwned: number,
): Promise<void> {
  const qtyToSell = qtyOwned;
  const saleValue = qtyToSell * currentPrice;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: { demo_balance: { increment: saleValue } },
      });
      await tx.demoPortfolio.deleteMany({
        where: { user_id: userId, symbol },
      });
      await tx.demoTrade.create({
        data: { user_id: userId, symbol, type: "SELL", quantity: qtyToSell, price: currentPrice },
      });
    });

    if (strategy === "GRID_BOT") {
      try {
        const bot = await prisma.demoBot.findUnique({ where: { id: botId } });
        if (bot?.parameters_json) {
          const params = JSON.parse(bot.parameters_json as string);
          delete params.baseline_price;
          await prisma.demoBot.update({
            where: { id: botId },
            data: { parameters_json: JSON.stringify(params) },
          });
        }
      } catch { /* best-effort */ }
    }

    await prisma.demoBotLog.create({
      data: {
        bot_id: botId,
        message: `\uD83D\uDD34 EXECUTE: ${triggerMessage} Sold ${qtyToSell.toFixed(5)} ${symbol} at $${currentPrice.toLocaleString()} ($${saleValue.toFixed(2)} USDT).`,
      },
    });
  } catch (e) {
    console.error(`Bot SELL error for bot ${botId}:`, e);
  }
}
