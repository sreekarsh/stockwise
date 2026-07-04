# StockWise — Full Stack Crypto/Stock Tracker

Production-ready full-stack application with real-time market data, ML-powered trading signals, and bot trading simulation.

## 📁 Project Structure

```
├── stockwise-fullstack/stockwise/   ← Main application
│   ├── server.ts                  ← Node.js backend (Express)
│   ├── package.json               ← Node dependencies
│   ├── Dockerfile                 ← Docker containerization
│   ├── docker-compose.yml         ← Docker compose
│   ├── railway.json               ← Railway deployment config
│   ├── .env.example               ← Environment template
│   ├── index.html                 ← Home page
│   ├── css/                       ← Stylesheets
│   ├── js/                        ← Frontend TypeScript/JavaScript
│   ├── pages/                     ← HTML pages
│   ├── services/                  ← Backend business logic
│   ├── routes/                    ← API endpoints
│   ├── middleware/                ← Auth, CSRF, error handling
│   ├── schemas/                   ← TypeScript schemas
│   ├── prisma/                    ← Database migrations
│   └── ml_engine/                 ← Python ML service
├── .github/workflows/ci.yml       ← GitHub Actions CI
├── .gitignore                     ← Git ignore rules
└── README.md                      ← This file
```

## 🚀 Quick Start

```bash
npm install
npx tsx stockwise-fullstack/stockwise/server.ts
```

Node runs at `http://localhost:3000` | ML service auto-starts at `http://127.0.0.1:8100`

## 🌐 Deployment

### Docker (Recommended)

```bash
cd stockwise-fullstack/stockwise && docker-compose up
```

### Railway (Free)

[![Deploy on Railway](https://railway.app/button.svg)](https://railway.app/new)

Or manually:
1. Go to railway.app → New Project → Deploy from GitHub repo
2. Select your **stockwise** repo
3. Set environment variables in Railway dashboard
4. Deploy

## 🔧 Environment Variables

Rename `stockwise-fullstack/stockwise/.env.example` to `.env` and configure:

| Variable | Purpose |
|----------|---------|
| `PORT` | Server port (default 3000) |
| `SESSION_SECRET` | Session & CSRF secret (generate 32+ hex chars) |
| `DATABASE_URL` | PostgreSQL connection (SQLite used if blank) |
| `GMAIL_USER` | Gmail address for alert emails |
| `GMAIL_PASS` | Gmail app password for SMTP |
| `COINGECKO_API_KEY` | CoinGecko API key (comma-separated for multi-key) |
| `FINNHUB_API_KEY` | Finnhub API key for stock quotes |
| `NEWSAPI_KEY` | NewsAPI.org key for news feed |
| `REDIS_URL` | Redis connection string |
| `ENCRYPTION_MASTER_KEY` | 64-char hex key for encrypting broker API keys |

## ✨ Core Features

| Feature | Details |
|---------|---------|
| 🔐 Auth | Login/Signup, bcrypt, sessions, email verification |
| 💼 Portfolio | Manual entry + CoinDCX sync |
| 📈 Live Tracker | 100+ coins + 150+ NSE stocks; updates every ~30s |
| 💱 Currency | INR↔USD conversion for stocks |
| 🔔 Alerts | Price alerts with Socket.io push + email notifications |
| 🤖 ML Signals | LSTM/PPO models for trading signals |
| 🌐 Community | Posts, likes, edit/delete, tags, group chat |
| 🔥 Bot Trading | Simulated bots, academy, bot logs, management |
| 🎨 Themes | Dark / Light / Ocean / Sunset themes |
| 🔤 Fonts | DM Sans / Inter / JetBrains Mono / Syne |
| 👤 Avatar | Customizable avatar studio |
| 💬 Voice Chat | Real-time voice rooms with admin controls |
| 💾 Offline | 77 top cryptocurrencies fallback when rate-limited |

## ⚙️ API Endpoints

### Auth
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/register` | Create account |
| POST | `/api/login` | Login |
| POST | `/api/logout` | Logout |
| GET | `/api/me` | Current user info |
| GET/POST | `/api/prefs` | Get/set user preferences |

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

## 🐍 ML Training

```bash
cd stockwise-fullstack/stockwise && python ml_engine/trainer.py
```

Trains LSTM/PPO models using Binance OHLCV and sentiment data.

## ⚠️ Notes

- Signals/ML are **educational only** — not financial advice
- CoinGecko free tier is rate-limited (~10-30 req/min)
- Multiple CoinGecko keys can be comma-separated for auto-rotation
- PostgreSQL via `DATABASE_URL` env var