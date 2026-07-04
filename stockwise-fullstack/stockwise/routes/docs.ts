import express from "express";

const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "StockWise API",
    version: "1.0.0",
    description: "Market intelligence, portfolio tracking, demo trading, and community platform. All endpoints are available under `/api` (and `/api/v1` for backward compatibility).",
  },
  servers: [{ url: "/api" }],
  components: {
    securitySchemes: {
      sessionCookie: { type: "apiKey", in: "cookie", name: "connect.sid" },
      csrfToken: { type: "apiKey", in: "header", name: "X-CSRF-Token" },
    },
    schemas: {
      Error: { type: "object", properties: { error: { type: "string" } } },
      Success: { type: "object", properties: { success: { type: "boolean" } } },
    },
  },
  security: [{ sessionCookie: [], csrfToken: [] }],
  paths: {
    // ─── System ──────────────────────────────────────────────────────
    "/health": {
      get: { summary: "Server health check (DB read/write, Redis, ML)", tags: ["System"], responses: { "200": { description: "Healthy" }, "503": { description: "Degraded" } } },
    },
    "/metrics": {
      get: { summary: "Prometheus metrics endpoint", tags: ["System"], responses: { "200": { description: "Prometheus plain-text metrics" } } },
    },
    "/flags": {
      get: { summary: "Feature flags", tags: ["System"], responses: { "200": { description: "Feature flag map" } } },
    },

    // ─── Auth ────────────────────────────────────────────────────────
    "/register": {
      post: { summary: "Create account", tags: ["Auth"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { username: { type: "string" }, email: { type: "string", format: "email" }, password: { type: "string", minLength: 6 }, phone: { type: "string" } }, required: ["username", "email", "password"] } } } }, responses: { "200": { description: "Account created" }, "400": { description: "Validation error or duplicate" } } },
    },
    "/login": {
      post: { summary: "Authenticate user", tags: ["Auth"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" }, password: { type: "string" }, remember: { type: "boolean" } }, required: ["email", "password"] } } } }, responses: { "200": { description: "Login success" }, "400": { description: "Invalid credentials" }, "403": { description: "Locked out" } } },
    },
    "/logout": {
      post: { summary: "End session", tags: ["Auth"], responses: { "200": { description: "Logged out" } } },
    },
    "/me": {
      get: { summary: "Current user info (profile, preferences, API key status)", tags: ["Auth"], responses: { "200": { description: "User data" } } },
    },
    "/forgot-password": {
      post: { summary: "Request password reset (notifies owner)", tags: ["Auth"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } }, required: ["email"] } } } }, responses: { "200": { description: "Request sent" } } },
    },
    "/reset-password": {
      post: { summary: "Reset password with token", tags: ["Auth"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { token: { type: "string" }, password: { type: "string" } }, required: ["token", "password"] } } } }, responses: { "200": { description: "Password reset" }, "400": { description: "Invalid or expired token" } } },
    },
    "/profile": {
      post: { summary: "Update profile (username, email, phone)", tags: ["Auth"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { username: { type: "string" }, email: { type: "string" }, phone: { type: "string" } }, required: ["username", "email"] } } } }, responses: { "200": { description: "Profile updated" }, "400": { description: "Validation error" } } },
    },
    "/api-keys": {
      post: { summary: "Update external API keys (CoinDCX, CoinGecko, News, Community)", tags: ["Auth"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { coindcx_key: { type: "string" }, coindcx_secret: { type: "string" }, news_api_key: { type: "string" }, community_api_key: { type: "string" }, coingecko_key: { type: "string" } } } } } }, responses: { "200": { description: "Keys updated" } } },
    },
    "/prefs": {
      get: { summary: "Get user preferences", tags: ["Auth"], responses: { "200": { description: "Preferences object" } } },
      post: { summary: "Update user preferences", tags: ["Auth"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { theme: { type: "string" }, currency: { type: "string" }, profile_color: { type: "string" }, demo_balance: { type: "number" } } } } } }, responses: { "200": { description: "Preferences updated" } } },
    },
    "/verify-email": {
      post: { summary: "Mark email as verified", tags: ["Auth"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { email: { type: "string" } } } } } }, responses: { "200": { description: "Verification status updated" } } },
    },
    "/save-keys": {
      post: { summary: "Save external API keys (alternative endpoint)", tags: ["Auth"], responses: { "200": { description: "Keys saved" } } },
    },
    "/login-logs": {
      get: { summary: "Recent login attempts for current user", tags: ["Auth"], responses: { "200": { description: "Login log array" } } },
    },

    // ─── Admin ────────────────────────────────────────────────────────
    "/admin/users": {
      get: { summary: "List all users (admin/moderator)", tags: ["Admin"], responses: { "200": { description: "User list" }, "403": { description: "Forbidden" } } },
    },
    "/admin/reset-requests": {
      get: { summary: "List password reset requests (admin)", tags: ["Admin"], responses: { "200": { description: "Reset request list" }, "403": { description: "Forbidden" } } },
    },
    "/admin/set-role": {
      post: { summary: "Set user role (admin only)", tags: ["Admin"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { userId: { type: "integer" }, role: { type: "string", enum: ["admin", "moderator", "vip", "user", "supporter", "member"] } }, required: ["userId", "role"] } } } }, responses: { "200": { description: "Role updated" }, "403": { description: "Forbidden" } } },
    },

    // ─── Portfolio ────────────────────────────────────────────────────
    "/portfolio": {
      get: { summary: "List portfolio holdings", tags: ["Portfolio"], responses: { "200": { description: "Portfolio items" } } },
      post: { summary: "Add portfolio item", tags: ["Portfolio"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { symbol: { type: "string" }, quantity: { type: "number" }, buy_price: { type: "number" } }, required: ["symbol", "quantity", "buy_price"] } } } }, responses: { "200": { description: "Item added" } } },
    },
    "/portfolio/{id}": {
      delete: { summary: "Delete portfolio item", tags: ["Portfolio"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Deleted" } } },
      put: { summary: "Update portfolio item", tags: ["Portfolio"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], requestBody: { content: { "application/json": { schema: { type: "object", properties: { quantity: { type: "number" }, buy_price: { type: "number" } } } } } }, responses: { "200": { description: "Updated" } } },
    },
    "/trade-history": {
      get: { summary: "Trade history", tags: ["Portfolio"], responses: { "200": { description: "Trade history array" } } },
    },
    "/stocks": {
      get: { summary: "Stock list with prices", tags: ["Markets"], parameters: [{ name: "q", in: "query", schema: { type: "string" }, description: "Search query" }], responses: { "200": { description: "Stock list" } } },
    },
    "/stocks/{symbol}/chart": {
      get: { summary: "Stock price chart data", tags: ["Markets"], parameters: [{ name: "symbol", in: "path", required: true, schema: { type: "string" } }, { name: "range", in: "query", schema: { type: "string" }, description: "Time range (1d, 5d, 1mo, etc.)" }], responses: { "200": { description: "Chart data" } } },
    },

    // ─── CoinDCX ──────────────────────────────────────────────────────
    "/coindcx/balances": {
      get: { summary: "CoinDCX account balances", tags: ["CoinDCX"], responses: { "200": { description: "Balances" } } },
    },
    "/sync-coindcx": {
      post: { summary: "Sync portfolio from CoinDCX", tags: ["CoinDCX"], responses: { "200": { description: "Sync result" } } },
    },
    "/coindcx/test": {
      post: { summary: "Test CoinDCX API connection", tags: ["CoinDCX"], responses: { "200": { description: "Connection test result" } } },
    },
    "/coindcx/orderbook": {
      get: { summary: "CoinDCX orderbook snapshot", tags: ["CoinDCX"], parameters: [{ name: "symbol", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Orderbook" } } },
    },
    "/coindcx/market-trades": {
      get: { summary: "CoinDCX recent market trades", tags: ["CoinDCX"], parameters: [{ name: "symbol", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Trades" } } },
    },
    "/coindcx/buy-price": {
      get: { summary: "CoinDCX buy price for a symbol", tags: ["CoinDCX"], parameters: [{ name: "symbol", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Buy price" } } },
    },
    "/coindcx/buy-prices": {
      get: { summary: "Batch CoinDCX buy prices", tags: ["CoinDCX"], parameters: [{ name: "symbols", in: "query", schema: { type: "string" }, description: "Comma-separated symbols" }], responses: { "200": { description: "Buy prices map" } } },
    },
    "/coindcx/markets": {
      get: { summary: "Available CoinDCX markets", tags: ["CoinDCX"], responses: { "200": { description: "Market list" } } },
    },

    // ─── Market Data ──────────────────────────────────────────────────
    "/market-trends": {
      get: { summary: "Market trend overview", tags: ["Markets"], responses: { "200": { description: "Trend data" } } },
    },
    "/news": {
      get: { summary: "Crypto news feed", tags: ["Markets"], responses: { "200": { description: "News articles" } } },
    },
    "/trending": {
      get: { summary: "Trending coins", tags: ["Markets"], responses: { "200": { description: "Trending list" } } },
    },
    "/markets": {
      get: { summary: "All market tickers", tags: ["Markets"], responses: { "200": { description: "Ticker array" } } },
    },
    "/coingecko-pro-price": {
      get: { summary: "CoinGecko Pro price data", tags: ["Markets"], parameters: [{ name: "ids", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Price data" } } },
    },
    "/coingecko-categories": {
      get: { summary: "CoinGecko coin categories", tags: ["Markets"], responses: { "200": { description: "Category list" } } },
    },
    "/fear-greed": {
      get: { summary: "Fear & Greed index", tags: ["Markets"], responses: { "200": { description: "Index value" } } },
    },
    "/coins/{id}/chart": {
      get: { summary: "Coin price chart", tags: ["Markets"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "days", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Chart data" } } },
    },
    "/rates": {
      get: { summary: "Exchange rates (INR/USD/etc.)", tags: ["Markets"], responses: { "200": { description: "Rates object" } } },
    },
    "/live-candles": {
      get: { summary: "Live candle data", tags: ["Markets"], parameters: [{ name: "symbol", in: "query", schema: { type: "string" } }, { name: "interval", in: "query", schema: { type: "string" } }], responses: { "200": { description: "Candle array" } } },
    },

    // ─── Community ────────────────────────────────────────────────────
    "/community": {
      get: { summary: "List community posts", tags: ["Community"], parameters: [{ name: "group_id", in: "query", schema: { type: "integer" } }, { name: "recipient_id", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Post list" } } },
      post: { summary: "Create community post", tags: ["Community"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { content: { type: "string" }, group_id: { type: "integer" }, recipient_id: { type: "integer" } }, required: ["content"] } } } }, responses: { "200": { description: "Post created" } } },
    },
    "/community/{id}": {
      put: { summary: "Update post", tags: ["Community"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Updated" } } },
      delete: { summary: "Delete post", tags: ["Community"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/community/{id}/like": {
      post: { summary: "Toggle like on a post", tags: ["Community"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Like toggled" } } },
    },
    "/bot-tips": {
      get: { summary: "Random onboarding tips", tags: ["Community"], parameters: [{ name: "path", in: "query", schema: { type: "string" }, description: "Current page path for contextual tips" }], responses: { "200": { description: "Tip object" } } },
    },

    // ─── Groups ───────────────────────────────────────────────────────
    "/groups": {
      get: { summary: "List groups", tags: ["Groups"], responses: { "200": { description: "Group list" } } },
      post: { summary: "Create group", tags: ["Groups"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, description: { type: "string" }, is_private: { type: "boolean" } }, required: ["name"] } } } }, responses: { "200": { description: "Group created" } } },
    },
    "/groups/{id}": {
      get: { summary: "Get group details", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Group data" } } },
    },
    "/groups/{id}/join": {
      post: { summary: "Join group", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Joined" } } },
    },
    "/groups/{id}/leave": {
      delete: { summary: "Leave group", tags: ["Groups"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Left" } } },
    },

    // ─── Friends ──────────────────────────────────────────────────────
    "/friends": {
      get: { summary: "List friends", tags: ["Friends"], responses: { "200": { description: "Friend list" } } },
    },
    "/friends/request": {
      post: { summary: "Send friend request by ID", tags: ["Friends"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { friend_id: { type: "integer" } }, required: ["friend_id"] } } } }, responses: { "200": { description: "Request sent" } } },
    },
    "/friends/request-by-identifier": {
      post: { summary: "Send friend request by username, email, or ID", tags: ["Friends"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { identifier: { type: "string" } }, required: ["identifier"] } } } }, responses: { "200": { description: "Request sent or auto-accepted" } } },
    },
    "/friends/accept": {
      post: { summary: "Accept incoming friend request", tags: ["Friends"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { friend_id: { type: "integer" } }, required: ["friend_id"] } } } }, responses: { "200": { description: "Accepted" } } },
    },
    "/friends/cancel": {
      post: { summary: "Cancel or decline friend request", tags: ["Friends"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { friend_id: { type: "integer" } }, required: ["friend_id"] } } } }, responses: { "200": { description: "Request removed" } } },
    },
    "/friends/suggestions": {
      get: { summary: "Friend suggestions based on shared holdings", tags: ["Friends"], responses: { "200": { description: "Suggestion list" } } },
    },

    // ─── Users ────────────────────────────────────────────────────────
    "/users/search": {
      get: { summary: "Search users by username", tags: ["Users"], parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "User list" } } },
    },
    "/users/{id}/profile": {
      get: { summary: "Get user profile", tags: ["Users"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Profile data" } } },
    },

    // ─── Avatar ───────────────────────────────────────────────────────
    "/avatar": {
      get: { summary: "Get current avatar config", tags: ["Avatar"], responses: { "200": { description: "Avatar config" } } },
      put: { summary: "Update avatar", tags: ["Avatar"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, bg_color: { type: "string" }, texture: { type: "string" }, accessory: { type: "string" }, energy: { type: "string" } } } } } }, responses: { "200": { description: "Avatar updated" } } },
    },
    "/avatar-presets": {
      get: { summary: "Available avatar presets", tags: ["Avatar"], responses: { "200": { description: "Preset list" } } },
    },

    // ─── ML Engine ────────────────────────────────────────────────────
    "/ml/health": {
      get: { summary: "ML service health check", tags: ["ML"], responses: { "200": { description: "ML status" } } },
    },
    "/ml/predict": {
      post: { summary: "Run ML prediction", tags: ["ML"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { symbol: { type: "string" }, prices: { type: "array", items: { type: "number" } } } } } } }, responses: { "200": { description: "Prediction result" } } },
    },
    "/ml/signals": {
      get: { summary: "Latest ML trading signals", tags: ["ML"], responses: { "200": { description: "Signal array" } } },
    },
    "/ml/regime": {
      get: { summary: "Market regime detection", tags: ["ML"], responses: { "200": { description: "Regime data" } } },
    },
    "/ml/sentiment": {
      get: { summary: "Market sentiment analysis", tags: ["ML"], responses: { "200": { description: "Sentiment score" } } },
    },
    "/ml/training-status": {
      get: { summary: "ML model training status", tags: ["ML"], responses: { "200": { description: "Training status" } } },
    },
    "/ml/train": {
      post: { summary: "Trigger ML model retraining", tags: ["ML"], responses: { "200": { description: "Training started" } } },
    },
    "/ml/performance": {
      get: { summary: "ML model performance metrics", tags: ["ML"], responses: { "200": { description: "Performance data" } } },
    },
    "/ml/completed": {
      get: { summary: "Recently completed training runs", tags: ["ML"], responses: { "200": { description: "Completed runs" } } },
    },

    // ─── Demo Trading ─────────────────────────────────────────────────
    "/demo/account": {
      get: { summary: "Demo trading account (balance, XP, level)", tags: ["Demo"], responses: { "200": { description: "Account data" } } },
    },
    "/demo/trade": {
      post: { summary: "Execute demo trade", tags: ["Demo"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { symbol: { type: "string" }, type: { type: "string", enum: ["BUY", "SELL"] }, quantity: { type: "number" }, price: { type: "number" } }, required: ["symbol", "type", "quantity", "price"] } } } }, responses: { "200": { description: "Trade executed" } } },
    },
    "/demo/reset": {
      post: { summary: "Reset demo account balance", tags: ["Demo"], responses: { "200": { description: "Reset complete" } } },
    },
    "/demo/bots": {
      get: { summary: "List trading bots", tags: ["Demo"], responses: { "200": { description: "Bot list" } } },
    },
    "/demo/bots/create": {
      post: { summary: "Create auto-trading bot", tags: ["Demo"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { name: { type: "string" }, symbol: { type: "string" }, strategy: { type: "string" }, initial_balance: { type: "number" } }, required: ["name", "symbol", "strategy"] } } } }, responses: { "200": { description: "Bot created" } } },
    },
    "/demo/bots/toggle": {
      post: { summary: "Start/stop a trading bot", tags: ["Demo"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { botId: { type: "integer" } }, required: ["botId"] } } } }, responses: { "200": { description: "Bot toggled" } } },
    },
    "/demo/bots/delete": {
      post: { summary: "Delete a trading bot", tags: ["Demo"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { botId: { type: "integer" } }, required: ["botId"] } } } }, responses: { "200": { description: "Bot deleted" } } },
    },
    "/demo/bots/logs": {
      get: { summary: "Bot trade logs", tags: ["Demo"], parameters: [{ name: "botId", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "Log array" } } },
    },
    "/demo/academy/complete": {
      post: { summary: "Mark academy lesson as complete", tags: ["Demo"], requestBody: { content: { "application/json": { schema: { type: "object", properties: { lesson: { type: "string" } } } } } }, responses: { "200": { description: "Lesson completed" } } },
    },

    // ─── Alerts ───────────────────────────────────────────────────────
    "/alerts": {
      get: { summary: "List price alerts", tags: ["Alerts"], responses: { "200": { description: "Alert list" } } },
      post: { summary: "Create price alert", tags: ["Alerts"], requestBody: { required: true, content: { "application/json": { schema: { type: "object", properties: { symbol: { type: "string" }, target_price: { type: "number" }, direction: { type: "string", enum: ["above", "below"] } }, required: ["symbol", "target_price", "direction"] } } } }, responses: { "200": { description: "Alert created" } } },
    },
    "/alerts/{id}": {
      delete: { summary: "Delete price alert", tags: ["Alerts"], parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "Deleted" } } },
    },
    "/webhooks/tradingview": {
      post: { summary: "TradingView webhook receiver", tags: ["Alerts"], responses: { "200": { description: "Webhook processed" } } },
    },

    // ─── Docs ────────────────────────────────────────────────────────
    "/docs": {
      get: { summary: "OpenAPI 3.0 spec as JSON", tags: ["Docs"], responses: { "200": { description: "OpenAPI spec" } } },
    },
    "/docs/ui": {
      get: { summary: "Swagger UI", tags: ["Docs"], responses: { "200": { description: "Swagger HTML page" } } },
    },
  },
};

const router = express.Router();

router.get("/docs", (req, res) => {
  res.json(openApiSpec);
});

router.get("/docs/ui", (req, res) => {
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <title>StockWise API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
</head>
<body style="margin:0">
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({ url: "/api/docs", dom_id: "#swagger-ui" });
  </script>
</body>
</html>`);
});

export default router;
