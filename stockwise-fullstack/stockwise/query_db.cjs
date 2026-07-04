const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, email: true, coindcx_sync_status: true }
  });
  console.log('--- Users ---');
  console.log(users);

  const holdings = await prisma.portfolio.findMany();
  console.log('\n--- Holdings ---');
  console.log(holdings);

  const trades = await prisma.tradeHistory.findMany({
    take: 10
  });
  console.log('\n--- Trade History (last 10) ---');
  console.log(trades);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
