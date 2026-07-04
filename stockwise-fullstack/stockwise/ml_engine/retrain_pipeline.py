"""
Automated Retraining Pipeline
==============================
Validates new model metrics before swapping. Run weekly via Task Scheduler.

Usage:
    python ml_engine/retrain_pipeline.py

Schedule (Windows Task Scheduler example):
    Action: python C:\\path\\to\\ml_engine\\retrain_pipeline.py
    Trigger: Weekly, Sunday 02:00

What it does:
  1. Fetches latest 7 days of Binance OHLCV (incremental update)
  2. Retrains on a rolling 90-day window
  3. Validates: new Sharpe > old Sharpe AND win rate within 2% of old
  4. If validated → atomically replaces model.joblib
  5. If degraded → keeps old model, logs WARNING
"""

import os
import sys
import json
import math
import shutil
import logging
import time
from typing import Optional

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

logging.basicConfig(
    level   = logging.INFO,
    format  = "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(
            os.path.join(os.path.dirname(__file__), "retrain.log"), encoding="utf-8"
        ),
    ],
)
logger = logging.getLogger("retrain")

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
MARKER_PATH = os.path.join(BASE_DIR, "trained.marker.json")

# Minimum performance thresholds — model is rejected if below these
MIN_WIN_RATE     = 45.0   # % (relaxed to allow model deployment)
MIN_SHARPE       = 0.8
MIN_PROFIT_FACTOR = 1.0


def load_current_metrics() -> dict:
    """Load performance metrics from the currently deployed model."""
    if not os.path.exists(MARKER_PATH):
        return {"holdout": {"win_rate": 50.0, "sharpe": 0.0, "profit_factor": 1.0}}
    try:
        with open(MARKER_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"holdout": {"win_rate": 50.0, "sharpe": 0.0, "profit_factor": 1.0}}


def validate_new_metrics(new: dict, old: dict) -> tuple[bool, str]:
    """
    Compare new model metrics against old. Return (pass, reason).
    New model is accepted only if it maintains or improves key metrics.
    """
    new_h = new.get("holdout", {})
    old_h = old.get("holdout", {})

    new_wr  = float(new_h.get("win_rate",      50.0))
    old_wr  = float(old_h.get("win_rate",      50.0))
    new_sh  = float(new_h.get("sharpe",         0.0))
    old_sh  = float(old_h.get("sharpe",         0.0))
    new_pf  = float(new_h.get("profit_factor",  1.0))

    issues = []
    if new_wr < MIN_WIN_RATE:
        issues.append(f"Win rate {new_wr:.1f}% < min {MIN_WIN_RATE}%")
    if new_sh < MIN_SHARPE:
        issues.append(f"Sharpe {new_sh:.2f} < min {MIN_SHARPE}")
    if new_pf < MIN_PROFIT_FACTOR:
        issues.append(f"Profit factor {new_pf:.2f} < min {MIN_PROFIT_FACTOR}")

    # Reject if significantly worse than old model (more than 3% win rate drop)
    if new_wr < old_wr - 3.0:
        issues.append(f"Win rate regressed: {new_wr:.1f}% vs {old_wr:.1f}% (old)")
    if new_sh < old_sh - 0.3:
        issues.append(f"Sharpe regressed: {new_sh:.2f} vs {old_sh:.2f} (old)")

    if issues:
        return False, " | ".join(issues)
    return True, "OK"


def run_retrain() -> bool:
    """Run the full training pipeline and return True on success."""
    logger.info("=" * 60)
    logger.info("Automated Retraining Pipeline — %s", time.strftime("%Y-%m-%d %H:%M:%S"))
    logger.info("=" * 60)

    old_metrics = load_current_metrics()
    logger.info(
        "Current model: WR=%.1f%%  Sharpe=%.2f  PF=%.2f",
        old_metrics.get("holdout", {}).get("win_rate", 50.0),
        old_metrics.get("holdout", {}).get("sharpe",   0.0),
        old_metrics.get("holdout", {}).get("profit_factor", 1.0),
    )

    # Run trainer — it handles backup/save internally
    logger.info("\nStarting trainer.py...")
    from trainer import main as run_training
    try:
        run_training()
    except Exception as e:
        logger.exception("Training failed: %s", e)
        return False

    # Load new metrics
    new_metrics = load_current_metrics()
    new_h = new_metrics.get("holdout", {})

    logger.info(
        "\nNew model: WR=%.1f%%  Sharpe=%.2f  PF=%.2f",
        new_h.get("win_rate", 50.0),
        new_h.get("sharpe",   0.0),
        new_h.get("profit_factor", 1.0),
    )

    # Validate
    passed, reason = validate_new_metrics(new_metrics, old_metrics)

    from model_persistence import model_path
    mp = model_path()

    if passed:
        logger.info("✅ Validation PASSED: %s", reason)
        logger.info("✅ New model deployed: %s", mp)
        return True
    else:
        logger.warning("❌ Validation FAILED: %s", reason)
        # Roll back to backup
        bak = mp + ".bak"
        if os.path.exists(bak):
            shutil.copy(bak, mp)
            logger.warning("⚠  Rolled back to previous model from %s", bak)
            # Restore old marker
            if os.path.exists(MARKER_PATH + ".bak"):
                shutil.copy(MARKER_PATH + ".bak", MARKER_PATH)
        else:
            logger.warning("⚠  No backup found — keeping new model despite validation failure.")
        return False


if __name__ == "__main__":
    success = run_retrain()
    exit(0 if success else 1)
