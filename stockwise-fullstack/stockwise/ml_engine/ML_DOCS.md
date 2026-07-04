# StockWise ML Engine Documentation

## Overview

The ML engine predicts BUY/SELL/HOLD signals for cryptocurrencies using a Gradient Boosting classifier trained on 44 engineered features.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Inference Flow                          │
├─────────────────────────────────────────────────────────────┤
│  /api/ml/predict (POST)                                   │
│         ↓                                                 │
│  ┌───────────────────────────────────────────────────┐   │
│  │ Auto-fetch Binance OHLCV if prices are synthetic    │   │
│  │ (triggered when <30 prices OR volatility <0.1%)   │   │
│  └───────────────────────────────────────────────────┘   │
│         ↓                                                 │
│  compute_features() - 44 features                        │
│         ↓                                                 │
│  MLPredictor.predict() → {signal, confidence, forecast}     │
│         ↓                                                 │
│  Trading plan: TP/SL adjusted by regime + funding           │
└─────────────────────────────────────────────────────────────┘
```

## Feature Groups (44 total)

| Group               | Features                                                                                   | Description                           |
| ------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------- |
| Momentum (5)        | ret_1h, ret_4h, ret_24h, ret_7d, ann_vol                                                   | Price returns & annualized volatility |
| Oscillators (5)     | rsi_14, macd_hist, macd_signal, pct_b, adx_raw                                             | Technical oscillator values           |
| Trend Position (3)  | price_sma20_ratio, price_ema12_ratio, sma_cross                                            | Price vs moving average ratios        |
| Volatility (4)      | atr, atr_pct, realised_vol, parkinson_vol                                                  | Volatility measures (real OHLCV)      |
| Multi-timeframe (3) | mtf_1h_mom, mtf_4h_mom, mtf_mtf_alignment                                                  | Multi-timeframe momentum              |
| Volume (5)          | volume_sma_ratio, volume_momentum, volume_zscore, vap_imbalance, vol_cluster               | Volume-based features                 |
| Other (3)           | temporal_attention, cross_asset_corr, sentiment_score                                      | Additional signals                    |
| Order Flow (3)      | ofi, volume_imbalance, ofi_4h                                                              | Order flow imbalance                  |
| Price (1)           | price                                                                                      | Current price                         |
| Candlestick (5)     | real_body_ratio, upper_wick_ratio, lower_wick_ratio, body_direction, consecutive_direction | Real OHLCV candlestick patterns       |
| VWAP (1)            | vwap_deviation                                                                             | Price vs VWAP deviation               |
| Derivatives (3)     | funding_rate, oi_change_pct, funding_oi_divergence                                         | Binance futures data                  |
| Regime (3)          | regime_state_0, regime_state_1, regime_state_2                                             | HMM market regime (one-hot)           |

## Endpoints

### Health Check

```
GET /health
Response: {status: "ok", model_version: "v3.0-real-ohlcv-sentiment-regime", is_fitted: true}
```

### Performance Metrics

```
GET /api/ml/performance
Response: {
  holdout_win_rate: 54.46,
  holdout_sharpe: 2.77,
  holdout_profit_factor: 1.13,
  n_samples: 23056,
  n_features: 44
}
```

### Regime Detection

```
GET /api/ml/regime?symbol=bitcoin
Response: {regime: "crab", state: 1, probabilities: {bear: 0.001, crab: 0.998, bull: 0.001}}
```

### Sentiment

```
GET /api/ml/sentiment?symbol=bitcoin
Response: {score: 0.42, sentiment: "bullish", scale: "[-1.0 bearish .. +1.0 bullish]"}
```

### Prediction (Auto-fetch Enabled)

```
POST /api/ml/predict
Body: {
  symbol: "bitcoin",
  prices: [50000, 50100, ...],  // Optional - auto-fetched if missing/synthetic
  volumes: [...],                 // Optional - auto-fetched if missing
  highs: [...],                  // Optional - auto-fetched if missing
  lows: [...],                   // Optional - auto-fetched if missing
  opens: [...]                   // Optional - auto-fetched if missing
}
Response: {
  signal: "BUY",
  confidence: 65.2,
  forecast: {direction: "UP", expected_pct: 2.4, expected_price: 51200},
  trading_plan: {entry: 50000, take_profit: 52000, stop_loss: 49000, risk_reward_ratio: 1.5},
  probabilities: {HOLD: 15.3, BUY: 65.2, SELL: 19.5},
  shap_top5: [{feature: "parkinson_vol", importance: 11.32}, ...]
}
```

## Training

```bash
# Default: 90 days
python ml_engine/trainer.py

# 180 days with 6-hour horizon
TRAIN_DAYS=180 HORIZON_HOURS=6 python ml_engine/trainer.py
```

### Training Output

- `ml_engine/model.joblib` - Trained model
- `ml_engine/regime_model.joblib` - HMM regime detector
- `ml_engine/trained.marker.json` - Training metrics

### Cross-Validation Strategy

- 5-fold rolling-window CV (no future leakage)
- 80/20 train/holdout split
- Minimum 54% win rate on holdout indicates valid signal

## Interpretation

- **Signal**: BUY/SELL/HOLD recommendation
- **Confidence**: Model probability of top class (20-70% typical)
- **Risk-Adjusted**: Focus on signals >30% confidence in volatile regimes
- **Regime Impact**:
  - Bull: Wider TP, let winners run
  - Crab: Moderate targets
  - Bear: Tighter SL, protect capital

## Accuracy Notes

Current model (trained on 90 days):

- Win Rate: ~54% (slightly above random)
- Sharpe: ~2.77 (good risk-adjusted)
- _These are educational signals only - not financial advice_
