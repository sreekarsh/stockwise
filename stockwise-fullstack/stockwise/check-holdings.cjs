const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const email = "sreekarsh44@gmail.com";

  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      portfolios: true,
      trades: true,
    },
  });

  if (!user) {
    console.error(`User ${email} not found.`);
    return;
  }

  console.log(`User ID: ${user.id}`);
  console.log(`Username: ${user.username}`);
  console.log(`CoinDCX Sync Status: ${user.coindcx_sync_status}`);
  console.log(`CoinDCX Last Synced: ${user.coindcx_last_synced}`);
  console.log(`CoinDCX Sync Error: ${user.coindcx_sync_error}`);
  console.log(`Number of holdings in Portfolio table: ${user.portfolios.length}`);
  console.log("Holdings list:");
  console.log(user.portfolios);

  console.log(`Number of trades in TradeHistory table: ${user.trades.length}`);
  console.log("Trades list (first 10):");
  console.log(user.trades.slice(0, 10));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
