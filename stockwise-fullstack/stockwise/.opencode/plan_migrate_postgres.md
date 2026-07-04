# PostgreSQL Migration Plan — StockWise

## Goal
Migrate from SQLite to PostgreSQL for production while guaranteeing zero data loss.

## Constraints
- Local dev must keep working (via Docker PostgreSQL)
- CI must remain fast (use SQLite in `.env.test`)
- All existing data in `stockwise.db` must be preserved with exact ID/PK values

---

## Step 1 — Install PostgreSQL driver + regenerate Prisma client

- Install `pg` npm package (Prisma's PostgreSQL adapter)
- Remove `better-sqlite3` dependency
- Run `npx prisma generate` after switching provider

## Step 2 — Update Prisma Schema

**`prisma/schema.prisma`**
- Change `provider = "sqlite"` → `provider = "postgresql"`
- No model changes needed — all types map cleanly

## Step 3 — Fix Raw SQL Queries for PostgreSQL

**`routes/community.js`** (lines 523–539)
- `$queryRawUnsafe` uses `?` placeholder (SQLite style)
- Change to `$1` (PostgreSQL style) in both queries
- Both `LOWER()` and `LIMIT` work identically on both — no changes needed

**`server.js`** (line 277)
- `SELECT 1` works on both — no change

## Step 4 — Create Data Migration Script

**`scripts/migrate-sqlite-to-postgres.js`**
- Reads all data from existing `stockwise.db` using `better-sqlite3` directly
- Connects to PostgreSQL via Prisma
- Inserts data in FK-safe order: Users → Groups → GroupMembers → CommunityPosts → Portfolio → Alerts → TradeHistory → DemoPortfolio → DemoTrades → DemoBot → DemoBotLog → LoginLog → Friends → SignalsMl → ModelVersions → BacktestResults → UserLearning
- Preserves exact integer IDs by passing `id` explicitly to `prisma.create()`
- Runs within a single Prisma interactive transaction per table
- Reports row counts and validates no data loss

## Step 5 — Update Environment Files

**`.env.example`**
- Add PostgreSQL `DATABASE_URL` as primary format
- Keep SQLite note for test/dev-only usage

**`.env`**
- Change to `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stockwise?schema=public`
- Add `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGHOST`, `PGPORT`

**`.env.test`**
- Keep SQLite for CI speed (uses `file:./test.db`)
- Add `NODE_ENV=test` flag to skip Prisma provider mismatch

**`config/env.js`**
- Add validation for `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` (optional)

## Step 6 — Update Docker & Deployment

**`docker-compose.yml`**
- Already has `stockwise-db` (TimescaleDB/PostgreSQL) — good
- The server service already passes `DATABASE_URL=postgresql://...` — consistent

**`Dockerfile`**
- Change `npx prisma db push` to `npx prisma migrate deploy` for safer production migrations
- Keep `prisma generate` step

**`ecosystem.config.js`**
- No changes needed (PM2 doesn't care about the database)

## Step 7 — Update CI

**`.github/workflows/ci.yml`**
- Add PostgreSQL service container for the `node` job
- Set `DATABASE_URL: postgresql://postgres:postgres@localhost:5432/stockwise_test?schema=public`
- Run `npx prisma migrate deploy` before tests

## Step 8 — Disable Prisma Cluster/Prepared Statements for SQLite (Safety)

- Add `connection_limit` and `pool` config hints to `services/db.js` for PostgreSQL

---

## Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | `provider = "postgresql"` |
| `routes/community.js` | `?` → `$1` in raw queries |
| `config/env.js` | Add optional PG vars |
| `.env` | PostgreSQL connection string |
| `.env.example` | PostgreSQL format + `DATABASE_URL` |
| `services/db.js` | PrismaClient with connection pool settings for PG |
| `Dockerfile` | `prisma migrate deploy` instead of `db push` |
| `.github/workflows/ci.yml` | Add PG service + migration step |

## Files to Create

| File | Purpose |
|------|---------|
| `scripts/migrate-sqlite-to-postgres.js` | One-time data migration |
| `scripts/README.md` | Instructions for running the migration |

## Files to Remove

| Dependency | Reason |
|------------|--------|
| `better-sqlite3` | SQLite-specific, no longer needed |

## Data Migration Order (FK-safe)

1. Users (no FK)
2. Groups (FK → Users)
3. GroupMembers (FK → Groups, Users)
4. CommunityPosts (FK → Users, Groups)
5. Portfolio (FK → Users)
6. Alerts (FK → Users)
7. TradeHistory (FK → Users)
8. DemoPortfolio (FK → Users)
9. DemoTrades (FK → Users)
10. DemoBot (FK → Users)
11. DemoBotLog (FK → DemoBot)
12. LoginLog (FK → Users, optional)
13. Friends (FK → Users × 2)
14. SignalsMl (no FK)
15. ModelVersions (no FK)
16. BacktestResults (no FK)
17. UserLearning (FK → Users)

## Verification

1. Run `node scripts/migrate-sqlite-to-postgres.js` against a test PG instance
2. Compare row counts per table between SQLite and PG
3. Run all 11 existing tests: `npm test` + `python -m pytest ml_engine/tests/`
4. Verify `/api/health` returns `db: "connected"`
5. Verify app boots without errors
6. Spot-check: login with an existing user, verify portfolio data loads
