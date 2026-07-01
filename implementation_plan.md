# ML Engine Upgrade — Academic → Production Grade

Upgrading the StockWise ML engine across all 5 dimensions described in the roadmap. The goal: real data fidelity for a sustained 55–62% out-of-sample accuracy with proper risk-adjusted edge.

---

## User Review Required

> [!IMPORTANT]
> **Binance API — No API key needed for public OHLCV data.** The Binance public REST API (`/api/v3/klines`) does not require authentication for historical candle data. We will use it for free. Funding rate and OI data also do not require a key.

> [!WARNING]
> **HMM + NLTK + VADER require new Python packages.** Running the upgrade requires `pip install hmmlearn nltk vaderSentiment pandas`. These will be installed automatically during setup but require an internet connection.

> [!NOTE]
> **The existing `model.joblib` will be replaced** when you run the new trainer. The old model will be backed up automatically as `model.joblib.bak`.

---

## Proposed Changes

### Dependency Layer

#### [MODIFY] [requirements.txt](file:///c:/Users/admin/Documents/trail3.1/stockwise-fullstack/stockwise/requirements.txt)
Add: `hmmlearn`, `vaderSentiment`, `nltk`, `pandas`, `joblib`, `scipy`

---

### New File — Data Ingestion

#### [NEW] `ml_engine/data_ingestion.py`
Replaces `coingecko_history.py` with a **Binance public REST API** fetcher that pulls genuine OHLCV (Open, High, Low, Close, Volume) candle data + funding rates + open interest. No API key needed. Includes exponential backoff and rate limit handling.

**Key functions:**
- `fetch_binance_ohlcv(symbol, interval, limit)` → real H/L/C/V bars
- `fetch_funding_rate(symbol)` → latest 8h funding rate
- `fetch_open_interest(symbol)` → OI in USD
- `fetch_multi_symbol_ohlcv(symbols, days)` → batch fetch for training

---

### New File — Sentiment Engine

#### [NEW] `ml_engine/sentiment.py`
A standalone NLP pipeline using **VADER** (Valence Aware Dictionary and sEntiment Reasoner — pre-trained, no model download needed) that:
1. Scrapes headlines from CoinGecko news API and CryptoCompare (no API key)
2. Scores each headline with VADER compound score (-1.0 to +1.0)
3. Time-decays older headlines (exponential decay, 4h half-life)
4. Returns a **rolling 4H sentiment score** per symbol

**Why VADER over FinBERT?** VADER is pre-trained, runs in milliseconds, needs no GPU, and performs comparably to transformers on short crypto headlines. FinBERT can be added later as an upgrade.

---

### New File — Market Regime Detector

#### [NEW] `ml_engine/regime.py`
A **Hidden Markov Model (HMM)** with 3 hidden states trained on:
- Returns
- Realised volatility
- Volume z-score

States automatically learn to represent:
- **State 0**: High-volatility bear / crash
- **State 1**: Low-volatility sideways chop  
- **State 2**: High-volatility bull / breakout

The regime state is passed as a **one-hot encoded categorical feature** to the main GBM, allowing it to apply different internal decision boundaries per regime.

---

### Upgrade — Feature Engineering

#### [MODIFY] [features.py](file:///c:/Users/admin/Documents/trail3.1/stockwise-fullstack/stockwise/ml_engine/features.py)
- **Remove** fake high/low simulation (`c ± rand(0.001, 0.003)`)
- **Accept** real `highs`, `lows`, `open` arrays from Binance OHLCV
- **Add** new features:
  - `funding_rate` — 8h perpetual funding rate (positive = over-leveraged long)
  - `oi_change_pct` — open interest % change vs 4H ago (divergence signal)
  - `regime_state_0/1/2` — one-hot encoded HMM regime
  - `real_body_ratio` — `|close-open| / (high-low)` — candlestick pattern strength
  - `upper_wick_ratio` / `lower_wick_ratio` — rejection signal from real wicks
  - `vwap_deviation` — price vs volume-weighted average price
  - `funding_oi_divergence` — funding rate rising while OI falling = short squeeze signal

**Total features: 32 → 42**

---

### Upgrade — Trainer

#### [MODIFY] [trainer.py](file:///c:/Users/admin/Documents/trail3.1/stockwise-fullstack/stockwise/ml_engine/trainer.py)
- Replace `coingecko_market_chart_close()` with `fetch_multi_symbol_ohlcv()` (Binance)
- Train HMM regime detector on the full dataset first
- Add regime labels to feature matrix
- Add live sentiment fetch during prediction
- Add proper **stratified chronological k-fold** cross-validation (5-fold rolling window)
- Backup existing `model.joblib` before overwriting
- **Expand training coins** to include more liquid pairs: BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE, MATIC, LINK, NEAR, ARB (12 coins)

---

### Upgrade — Model

#### [MODIFY] [model.py](file:///c:/Users/admin/Documents/trail3.1/stockwise-fullstack/stockwise/ml_engine/model.py)
- Update `FEATURE_NAMES` list to include 42 features
- Update `predict()` to accept sentiment score dynamically (not hardcoded 0.5)
- Add `regime_state` as input parameter
- Improve `_trading_plan()` to scale TP/SL based on funding rate extremes

---

### New File — Automated Retraining Pipeline

#### [NEW] `ml_engine/retrain_pipeline.py`
A self-contained script that:
1. Fetches latest 7 days of Binance OHLCV
2. Retrains the model on the rolling 90-day window
3. **Validates**: new Sharpe > old Sharpe AND new win rate > old win rate - 2%
4. If validated: atomically replaces `model.joblib` and updates `trained.marker.json`
5. If not: keeps old model, logs degradation warning

Run manually weekly or schedule with Windows Task Scheduler:
```
python ml_engine/retrain_pipeline.py
```

---

### Upgrade — ML Inference Server

#### [MODIFY] [server.py](file:///c:/Users/admin/Documents/trail3.1/stockwise-fullstack/stockwise/ml_engine/server.py)
- Add `/api/ml/regime` endpoint — returns current market regime state for a symbol
- Add `/api/ml/sentiment` endpoint — returns live sentiment score
- Update `predict()` to dynamically fetch sentiment and regime before inference
- Add background task that refreshes regime state every 15 minutes

---

## Verification Plan

### Automated Tests
```bash
# 1. Install new deps
pip install hmmlearn vaderSentiment nltk pandas scipy joblib

# 2. Test data ingestion
python ml_engine/data_ingestion.py

# 3. Test sentiment pipeline
python ml_engine/sentiment.py

# 4. Test regime detector in isolation
python ml_engine/regime.py

# 5. Run full trainer (takes ~5–10 min for 12 symbols × 90 days)
python ml_engine/trainer.py

# 6. Start ML server and verify
python ml_engine/server.py
# curl http://localhost:8100/health
# curl http://localhost:8100/api/ml/performance
```

### Expected Metrics After Upgrade

| Metric | Before | Expected After |
|---|---|---|
| Data quality | Close-only + noise | Real OHLCV |
| Feature count | 32 | 42 |
| Sentiment | Hardcoded 0.5 | Live VADER score |
| Regime awareness | None | 3-state HMM |
| OI / Funding | None | Live Binance data |
| Out-of-sample win rate | ~55–65% | **58–68%** |
| Sharpe ratio | ~1.4 | **1.6–2.1** |

### Manual Verification
- Check `trained.marker.json` for updated `n_samples` (should be significantly higher with 12 coins × 90 days)
- Verify sentiment endpoint returns non-0.5 values for BTC
- Verify regime endpoint returns 0, 1, or 2 (not null)
