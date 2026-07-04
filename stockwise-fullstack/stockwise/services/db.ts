import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  // Connection pooling for PgBouncer — use ?pgbouncer=true in DATABASE_URL
  // and set connection_limit to match PgBouncer pool size
  ...(process.env.DATABASE_URL?.includes("pgbouncer=true")
    ? {
        datasources: { db: { url: process.env.DATABASE_URL } },
      }
    : {}),
});

export default prisma;
export { prisma };
