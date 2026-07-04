/**
 * migrate-sqlite-to-postgres.js
 *
 * One-time migration script: exports all data from the existing SQLite
 * database (`stockwise.db`) and imports it into PostgreSQL via native pg driver.
 *
 * Preserves exact integer IDs so foreign keys remain valid.
 *
 * Usage:  node scripts/migrate-sqlite-to-postgres.js
 *
 * Prerequisites:
 *   1. Ensure PostgreSQL is running (e.g. docker compose up stockwise-db)
 *   2. Set DATABASE_URL in .env to point at your PostgreSQL database:
 *      DATABASE_URL=postgresql://postgres:postgres@localhost:5432/stockwise?schema=public
 *   3. Create the schema:  npx prisma db push
 *   4. Run this script:    node scripts/migrate-sqlite-to-postgres.js
 */

import initSqlJs from "sql.js";
import fs from "fs";
import path from "path";
import pg from "pg";
import { fileURLToPath } from "url";

const { Pool } = pg;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SQLITE_PATH = path.join(__dirname, "..", "stockwise.db");

const TABLES_IN_ORDER = [
  "users",
  "groups",
  "group_members",
  "community_posts",
  "portfolio",
  "alerts",
  "trade_history",
  "demo_portfolio",
  "demo_trades",
  "demo_bots",
  "demo_bot_logs",
  "login_logs",
  "friends",
  "signals_ml",
  "model_versions",
  "backtest_results",
  "user_learning",
];

// Columns that must be integers (empty string → 0)
const INTEGER_COLUMNS = new Set([
  "id", "user_id", "friend_id", "group_id", "recipient_id", "bot_id",
  "is_verified", "trader_xp", "likes", "triggered", "success", "completed",
  "total_trades", "horizon_hours", "created_by",
]);

// Columns that must be floats
const FLOAT_COLUMNS = new Set([
  "quantity", "buy_price", "avg_buy_price", "price", "total",
  "target_price", "demo_balance",
  "confidence", "probability_buy", "probability_sell", "probability_hold",
  "forecast_pct", "expected_price", "ci_low", "ci_high",
  "entry_price", "take_profit", "stop_loss", "risk_reward",
  "win_rate", "profit_factor", "sharpe", "max_drawdown",
]);

// Columns that are genuinely nullable (keep null as null)
const NULLABLE_COLUMNS = new Set([
  "reset_token_expiry", "recipient_id", "group_id",
  "notes", "parameters_json", "shap_json",
  "model_version", "period_start", "period_end",
  "total_trades", "horizon_hours", "total", "user_id",
  "confidence", "probability_buy", "probability_sell", "probability_hold",
  "forecast_pct", "expected_price", "ci_low", "ci_high",
  "entry_price", "take_profit", "stop_loss", "risk_reward",
  "win_rate", "profit_factor", "sharpe", "max_drawdown",
]);

// Columns that are timestamps (may contain epoch millis that need conversion)
const TIMESTAMP_COLUMNS = new Set([
  "reset_token_expiry", "created_at", "updated_at", "completed_at",
  "trained_at", "computed_at", "login_at", "joined_at", "generated_at",
]);

function coerceValue(val, col) {
  if (val === null || val === undefined) {
    if (NULLABLE_COLUMNS.has(col)) return null;
    if (INTEGER_COLUMNS.has(col)) return 0;
    if (FLOAT_COLUMNS.has(col)) return 0.0;
    return "";
  }
  if (TIMESTAMP_COLUMNS.has(col) && typeof val === "number") {
    return new Date(val).toISOString().replace("T", " ").replace("Z", "");
  }
  if (val === "") {
    if (INTEGER_COLUMNS.has(col)) return 0;
    if (FLOAT_COLUMNS.has(col)) return 0.0;
    if (NULLABLE_COLUMNS.has(col)) return null;
    return "";
  }
  return val;
}

async function main() {
  if (!fs.existsSync(SQLITE_PATH)) {
    console.error(`SQLite database not found at ${SQLITE_PATH}`);
    process.exitCode = 1;
    return;
  }

  console.log("Opening SQLite database...");
  const SQL = await initSqlJs();
  const buffer = fs.readFileSync(SQLITE_PATH);
  const sqlite = new SQL.Database(buffer);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  console.log("Connected to PostgreSQL.\n");

  let totalRows = 0;

  for (const table of TABLES_IN_ORDER) {
    const stmt = sqlite.prepare(`SELECT * FROM "${table}"`);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();

    if (rows.length === 0) {
      console.log(`  ${table}: 0 rows (skipping)`);
      continue;
    }

    console.log(`  ${table}: ${rows.length} rows · inserting...`);

    // Intersect SQLite columns with PostgreSQL columns to handle schema drift
    const pgCols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [table]
    );
    const pgColumnNames = new Set(pgCols.rows.map(r => r.column_name));
    const columns = Object.keys(rows[0]).filter(c => pgColumnNames.has(c));

    if (columns.length === 0) {
      console.log(`  ${table}: no matching columns (skipping)`);
      continue;
    }

    const skipped = Object.keys(rows[0]).length - columns.length;
    if (skipped > 0) {
      console.log(`  ${table}: skipped ${skipped} unknown column(s)`);
    }

    const colList = columns.join(', ');
    const paramList = columns.map((_, i) => `$${i + 1}`).join(', ');
    const insertSql = `INSERT INTO "${table}" (${colList}) VALUES (${paramList})`;

    for (const row of rows) {
      const values = columns.map((c) => coerceValue(row[c], c));

      try {
        await client.query(insertSql, values);
      } catch (err) {
        // Show the full row data for debugging
        const rowPreview = {};
        for (const c of columns) {
          rowPreview[c] = { val: row[c], type: typeof row[c] };
        }
        console.error(`  FAILED on ${table} id=${row.id}: ${err.message}`);
        console.error("  Row data:", JSON.stringify(rowPreview, null, 2));
        throw err;
      }
    }

    totalRows += rows.length;
  }

  sqlite.close();
  client.release();
  await pool.end();

  console.log(`\nDone. Migrated ${totalRows} total rows across ${TABLES_IN_ORDER.length} tables.`);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exitCode = 1;
});
