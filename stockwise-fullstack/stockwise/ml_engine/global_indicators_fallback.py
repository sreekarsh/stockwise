"""
Global Indicators Fallback
=========================
This module provides offline fallback values for global market indicators
(S&P 500, DXY, BTC Dominance) to prevent training from getting stuck when
external APIs fail or hit rate limits.

Use this fallback in trainer.py during the data ingestion phase.
"""

import time
import logging

logger = logging.getLogger(__name__)

# Fallback values that should be updated periodically based on current market conditions
FALLBACK_INDICATORS = {
    "gspc": {  # S&P 500
        "^GSPC": {
            1730464800000: 4550.00,  # Base value with unique timestamp
            "last_update": time.time()
        }
    },
    "dxy": {  # US Dollar Index
        "DX-Y.NYB": {
            1730464800000: 105.00,  # Base value with unique timestamp
            "last_update": time.time()
        }
    },
    "btc_dom": {  # Bitcoin Dominance
        1730464800000: 52.5,  # Base percentage
        "last_update": time.time()
    }
}

def get_global_indicators_fallback(days: int = 90) -> dict:
    """
    Provide offline fallback global indicators.
    Returns a dict structured like the API response for compatibility.
    """
    current_time = time.time()
    cutoff_timestamp = current_time - (days * 24 * 60 * 60)  # days ago
    
    result = {
        "^GSPC": {},
        "DX-Y.NYB": {},
        "btc_dominance": 0.0,
        "last_fetch": current_time
    }
    
    for key, value in FALLBACK_INDICATORS.items():
        if key == "gspc":
            for ts, price in value["^GSPC"].items():
                if ts >= cutoff_timestamp:
                    result["^GSPC"][ts] = price
        elif key == "dxy":
            for ts, price in value["DX-Y.NYB"].items():
                if ts >= cutoff_timestamp:
                    result["DX-Y.NYB"][ts] = price
        elif key == "btc_dom":
            result["btc_dominance"] = value["dominance"]
    
    return result

# Specialized fallback for btc_dominance - always available
def get_btc_dominance_fallback() -> float:
    """
    Fallback bitcoin dominance percentage.
    Update this value periodically based on current market conditions.
    """
    # This should be updated to reflect current BTC dominance
    return 52.5

# Usage in trainer.py:
# Instead of: global_indicators = fetch_global_indicators(days=90)
# Use: 
# try:
#     global_indicators = fetch_global_indicators(days=90)
# except Exception:
#     global_indicators = get_global_indicators_fallback(days=90)
#     logger.warning("Using global indicators fallback - training will continue")
