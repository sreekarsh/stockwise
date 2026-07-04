# StockWise — Full Stack Setup Guide

Updated for current ML v3 + live ML endpoints, real-time analytics, and production-grade security/observability.

## 📁 Project Structure

```
stockwise/
├── server.ts                 ← Node.js backend (Express + SQLite)
├── package.json              ← Node dependencies
├── index.html                ← Home page
├── Dockerfile
├── start.bat
├── start_ml.bat
├── railway.json
├── .env
├── stockwise.db
├── nodemon.json
├── css/
├── js/
├── pages/
│   ├── tracker.html
│   ├── signals.html
│   ├── portfolio.html
│   ├── community.html
│   ├── analyzer.html
│   ├── admin.html
│   ├── profile.html
│   ├── avatar.html
│   ├── security.html
│   ├── help.html
│   └── bot-trading.html
├── services/
│   ├── alertService.ts       ← Alert engine (checks prices every 60s)
│   ├── mailService.ts        ← Gmail SMTP email notifications
│   ├── stockTickerService.ts ← NSE stock feed via Yahoo Finance
│   └── websocketService.ts
└── ml_engine/
    ├── server.py
    ├── trainer.py
    ├── model.py
    ├── features.py
    ├── sentiment.py
    ├── regime.py
    ├── data_ingestion.py
    ├── coingecko_history.py
    ├── model_persistence.py
    ├── retrain_pipeline.py
    ├── model.joblib
    ├── regime_model.joblib
    ├── trained.marker.json
    └── ml_engine/  (subfolder)
```

---

## 🚀 How to Run (Local)

### 1) Install Node.js

Download from https://nodejs.org (choose LTS version)

### 2) Start the Node backend

Open terminal in the `stockwise` folder:

```bash
cd stockwise
npm install
npx tsx server.ts
```

Node runs at:

- **http://localhost:3000** (default, set `PORT` in `.env` to change)

> ⚠️ If port 3000 is already in use, kill the process or change `PORT=3001` in `.env`.

### 3) ML service (auto-start)

`server.ts` automatically starts the Python ML service from:

- `ml_engine/server.py`

ML runs at:

- **http://127.0.0.1:8100**

Health:

- **GET http://127.0.0.1:8100/health**

---

## 🔧 Environment Variables (.env)

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Session & CSRF secret (generate 32+ hex chars) |
| `DATABASE_URL` | PostgreSQL connection (SQLite used if blank) |
| `GMAIL_USER` | Gmail address for sending alert emails |
| `GMAIL_PASS` | Gmail app password for SMTP |
| `COINGECKO_API_KEY` | CoinGecko API key (comma-separated for multi-key rotation) |
| `FINNHUB_API_KEY` | Finnhub API key for stock quotes |
| `NEWSAPI_KEY` | NewsAPI.org key for news feed |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_MASTER_KEY` | 64-char hex key for encrypting broker API keys |
| `DOMAIN` | Domain for production HTTPS/Caddy |

---

## 🔑 CoinDCX API Key Setup (Portfolio Sync)

1. Login to https://coindcx.com
2. Click **Profile → API Keys → Create New Key**
3. Enable **Read Only** permission
4. Copy **API Key** + **Secret Key**
5. In StockWise → **Portfolio** → click **CoinDCX API Keys**
6. Paste both keys → **Save & Sync**

---

## ✨ Core Features

| Feature | Details |
|---------|---------|
| 🔐 Login/Signup | SQLite, bcrypt, sessions, email verification |
| 💼 Portfolio | Manual entry + CoinDCX sync |
| 📈 Live Tracker | 100+ coins + 150+ NSE stocks; updates every ~30s |
| 💱 INR↔USD Conversion | Indian stock prices auto-convert based on currency picker |
| 🔔 Alerts | Price alerts with real-time Socket.io push + email notifications |
| 🔔 Alert Panel | Bell icon in navbar with badge count, dropdown with active/triggered alerts |
| 🤖 Signals | ML-based signals when ML is ready; fallback JS signals otherwise |
| 🌐 Community | Posts, likes, edit/delete, tags |
| 🏘 Group Chat | Create/join topic groups + post inside groups |
| 🔥 Bot Trading | Simulated bot trading, academy, bot logs, bot management |
| 😊 Stickers | Emoji sticker picker |
| 📰 News | Crypto news feed via NewsAPI / CryptoCompare (proxy) |
| 🔥 Trending | CoinGecko trending |
| 😰 Fear & Greed | Alternative.me Fear & Greed |
| 🔬 Analyzer | Diversity/risk score + recommendations |
| 🎨 Theme Picker | Dark / Light / Ocean / Sunset themes |
| 🔤 Font Picker | DM Sans / Inter / JetBrains Mono / Syne for UI + tracker |
| 👤 Avatar Studio | Customizable among-us style avatar |
| 🔐 Security Page | Login history, active sessions |
| 💬 Voice Chat | Real-time voice rooms with admin mute/kick |
| 💾 Offline Fallback | 77 real top cryptocurrencies shown when CoinGecko is rate-limited |

### 🔔 Alert System

- **Setting alerts**: Click 🔔 on any coin/stock card → set target price + direction (above/below)
- **Engine**: Background check every 60s compares prices against `latestPrices` map
- **Notifications**:
  - Socket.io push to user room (`user:{userId}`) — real-time toast + bell badge update
  - Email sent via Gmail SMTP to the user's registered email (if configured)
  - Browser Notification API (desktop notification if permitted)
- **UI**: Bell icon in navbar with badge → slide-out panel showing active alerts (with delete) + triggered history
- **History**: `GET /api/alerts/history` returns last 20 triggered alerts

### 🎨 Theme & Font Preferences

- **Themes**: Dark (default), Light, Ocean (blue), Sunset (warm)
- **Fonts**: DM Sans, Inter, JetBrains Mono, Syne
- **Tracker font**: Separate picker for the tracker grid (DM Sans, JetBrains Mono, Monospace)
- Saved per-user, applied instantly on save via `data-theme`/`data-font`/`data-tracker-font` attributes on `<html>`

### 📈 Stock Tracker

- **150+ NSE stocks** with real-time prices via Yahoo Finance API
- **Categories**: NIFTY 50, Next 50, Midcap, Smallcap
- **USD conversion**: Indian stock prices auto-converted from INR to USD when currency is set to USD/USDT
- **Sources**: Yahoo Finance (primary), Finnhub (fallback), mock quotes (last resort)

### 🔑 CoinGecko Multi-Key Rotation

- `COINGECKO_API_KEY` supports **comma-separated** keys: `CG-key1,CG-key2`
- Auto-rotates to next key when 429 (rate limit) is encountered
- Per-user override via `coingecko_key` field on user profile

---

## ⚙️ API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Login |
| POST | `/api/logout` | Logout |
| GET | `/api/me` | Current user info (incl. theme/font prefs) |
| GET/POST | `/api/prefs` | Get/set user preferences (theme, font, currency) |

### Markets
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/markets` | CoinGecko crypto prices (250 coins) |
| GET | `/api/markets?category=trending` | Trending coins |
| GET | `/api/stocks` | NSE stock prices |
| GET | `/api/stocks/:symbol/chart` | Stock price history |
| GET | `/api/rates` | USD→INR exchange rate |

### Alerts
| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/alerts` | User's active alerts |
| GET | `/api/alerts/history` | Last 20 triggered alerts |
| POST | `/api/alerts` | Create alert `{symbol, target_price, direction}` |
| DELETE | `/api/alerts/:id` | Delete an alert |

### ML
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/ml/predict` | Price prediction |
| GET | `/api/ml/regime?symbol=bitcoin` | Market regime |
| GET | `/api/ml/sentiment?symbol=bitcoin` | Sentiment score |
| GET | `/api/ml/performance` | Model performance |
| POST | `/api/ml/signals` | Batch signals |

---

## 🐍 ML Training (Run Manually)

To train/update the model:

1. (Recommended) Create a virtualenv and install python deps
2. Run:

```bash
python ml_engine/trainer.py
```

This will:
- fetch Binance OHLCV
- compute sentiment
- train regime detector
- train predictor model
- write:
  - `ml_engine/model.joblib`
  - `ml_engine/trained.marker.json`

Python dependencies are listed in `requirements.txt`.

---

## 🌐 Deploy to Railway (Free)

### One-Click Deploy

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

### Manual Steps

1. Push repo to GitHub
2. Go to **railway.app → New Project → Deploy from GitHub repo**
3. Select your **stockwise** repo
4. Railway will detect `Dockerfile` and build
5. Set environment variables:
   - `COINGECKO_API_KEY` (optional)
   - `GMAIL_USER` / `GMAIL_PASS` (optional)
6. Deploy

---

## ⚠️ Notes

- `server.ts` uses a hard-coded ML base URL `http://127.0.0.1:8100` to avoid Windows localhost IPv4/IPv6 issues.
- Signals/ML are **educational only** — not financial advice.
- User data stored in `stockwise.db` (SQLite file, auto-created).
- CoinGecko free tier is rate-limited (~10-30 req/min). Set `COINGECKO_API_KEY` for better reliability.
- Email alerts require `GMAIL_USER` + `GMAIL_PASS` (app password) in `.env`.
- Multiple CoinGecko keys can be comma-separated for automatic rotation on rate limits.
