-- CreateEnum
-- (no enums used in this schema)

-- CreateTable users
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "phone" TEXT NOT NULL DEFAULT '',
    "reset_token" TEXT NOT NULL DEFAULT '',
    "reset_token_expiry" TIMESTAMP(3),
    "coindcx_key" TEXT NOT NULL DEFAULT '',
    "coindcx_secret" TEXT NOT NULL DEFAULT '',
    "news_api_key" TEXT NOT NULL DEFAULT '',
    "community_api_key" TEXT NOT NULL DEFAULT '',
    "coingecko_key" TEXT NOT NULL DEFAULT '',
    "role" TEXT NOT NULL DEFAULT 'user',
    "is_verified" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "profile_color" TEXT NOT NULL DEFAULT '',
    "currency" TEXT NOT NULL DEFAULT '',
    "theme" TEXT NOT NULL DEFAULT '',
    "avatar_name" TEXT NOT NULL DEFAULT '',
    "avatar_bg_color" TEXT NOT NULL DEFAULT '',
    "avatar_texture" TEXT NOT NULL DEFAULT '',
    "avatar_accessory" TEXT NOT NULL DEFAULT '',
    "avatar_energy" TEXT NOT NULL DEFAULT '',
    "coindcx_sync_status" TEXT NOT NULL DEFAULT '',
    "coindcx_last_synced" TEXT NOT NULL DEFAULT '',
    "coindcx_total_invested" TEXT NOT NULL DEFAULT '',
    "coindcx_sync_error" TEXT NOT NULL DEFAULT '',
    "demo_balance" DOUBLE PRECISION NOT NULL DEFAULT 10000.0,
    "trader_xp" INTEGER NOT NULL DEFAULT 0,
    "trader_level" TEXT NOT NULL DEFAULT 'Novice',

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable portfolio
CREATE TABLE "portfolio" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "buy_price" DOUBLE PRECISION NOT NULL,
    "asset_type" TEXT NOT NULL DEFAULT 'crypto',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable community_posts
CREATE TABLE "community_posts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "username" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "coin" TEXT NOT NULL DEFAULT '',
    "recipient_id" INTEGER,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "group_id" INTEGER,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "community_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable alerts
CREATE TABLE "alerts" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "target_price" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "triggered" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable login_logs
CREATE TABLE "login_logs" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "login_type" TEXT NOT NULL DEFAULT 'login',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "success" INTEGER NOT NULL DEFAULT 1,
    "login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable groups
CREATE TABLE "groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "created_by" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable group_members
CREATE TABLE "group_members" (
    "id" SERIAL NOT NULL,
    "group_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable friends
CREATE TABLE "friends" (
    "user_id" INTEGER NOT NULL,
    "friend_id" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "friends_pkey" PRIMARY KEY ("user_id","friend_id")
);

-- CreateTable trade_history
CREATE TABLE "trade_history" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "trade_id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION,
    "created_at" TEXT,

    CONSTRAINT "trade_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable signals_ml
CREATE TABLE "signals_ml" (
    "id" SERIAL NOT NULL,
    "symbol" TEXT NOT NULL,
    "asset_type" TEXT NOT NULL DEFAULT 'crypto',
    "signal" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "probability_buy" DOUBLE PRECISION,
    "probability_sell" DOUBLE PRECISION,
    "probability_hold" DOUBLE PRECISION,
    "forecast_pct" DOUBLE PRECISION,
    "expected_price" DOUBLE PRECISION,
    "ci_low" DOUBLE PRECISION,
    "ci_high" DOUBLE PRECISION,
    "entry_price" DOUBLE PRECISION,
    "take_profit" DOUBLE PRECISION,
    "stop_loss" DOUBLE PRECISION,
    "risk_reward" DOUBLE PRECISION,
    "horizon_hours" INTEGER,
    "shap_json" TEXT,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signals_ml_pkey" PRIMARY KEY ("id")
);

-- CreateTable model_versions
CREATE TABLE "model_versions" (
    "id" SERIAL NOT NULL,
    "version" TEXT NOT NULL,
    "trained_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,

    CONSTRAINT "model_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable backtest_results
CREATE TABLE "backtest_results" (
    "id" SERIAL NOT NULL,
    "model_version" TEXT,
    "period_start" TEXT,
    "period_end" TEXT,
    "win_rate" DOUBLE PRECISION,
    "profit_factor" DOUBLE PRECISION,
    "sharpe" DOUBLE PRECISION,
    "max_drawdown" DOUBLE PRECISION,
    "total_trades" INTEGER,
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "backtest_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable demo_portfolio
CREATE TABLE "demo_portfolio" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "avg_buy_price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_portfolio_pkey" PRIMARY KEY ("id")
);

-- CreateTable demo_trades
CREATE TABLE "demo_trades" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "symbol" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable demo_bots
CREATE TABLE "demo_bots" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "parameters_json" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable demo_bot_logs
CREATE TABLE "demo_bot_logs" (
    "id" SERIAL NOT NULL,
    "bot_id" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demo_bot_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable user_learning
CREATE TABLE "user_learning" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "lesson_id" TEXT NOT NULL,
    "completed" INTEGER NOT NULL DEFAULT 1,
    "completed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_learning_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "portfolio_user_id_symbol_key" ON "portfolio"("user_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "group_members_group_id_user_id_key" ON "group_members"("group_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "trade_history_trade_id_key" ON "trade_history"("trade_id");

-- CreateIndex
CREATE INDEX "signals_ml_symbol_generated_at_idx" ON "signals_ml"("symbol", "generated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "demo_portfolio_user_id_symbol_key" ON "demo_portfolio"("user_id", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX "user_learning_user_id_lesson_id_key" ON "user_learning"("user_id", "lesson_id");

-- AddForeignKey
ALTER TABLE "portfolio" ADD CONSTRAINT "portfolio_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "community_posts" ADD CONSTRAINT "community_posts_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_logs" ADD CONSTRAINT "login_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "friends" ADD CONSTRAINT "friends_friend_id_fkey" FOREIGN KEY ("friend_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trade_history" ADD CONSTRAINT "trade_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_portfolio" ADD CONSTRAINT "demo_portfolio_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_trades" ADD CONSTRAINT "demo_trades_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_bots" ADD CONSTRAINT "demo_bots_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demo_bot_logs" ADD CONSTRAINT "demo_bot_logs_bot_id_fkey" FOREIGN KEY ("bot_id") REFERENCES "demo_bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_learning" ADD CONSTRAINT "user_learning_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
