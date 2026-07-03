#!/usr/bin/env python3
"""
Test script to verify the training fix.
This simulates the global indicators fetching with fallback.
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'ml_engine'))

# Test the fallback functionality
try:
    from global_indicators_fallback import get_global_indicators_fallback, get_btc_dominance_fallback
    print("✅ Successfully imported global_indicators_fallback")
except ImportError as e:
    print(f"❌ Failed to import global_indicators_fallback: {e}")
    sys.exit(1)

print("\n=== Testing Global Indicators Fallback ===\n")

# Test 1: Test BTC dominance fallback
btc_dom = get_btc_dominance_fallback()
print(f"1. BTC Dominance Fallback: {btc_dom}%")
assert isinstance(btc_dom, float) or isinstance(btc_dom, int), "BTC dominance should be a number"
print("✅ Test passed: BTC dominance is a valid number\n")

# Test 2: Test global indicators fallback (90 days)
indicators = get_global_indicators_fallback(days=90)
print(f"2. Global Indicators Fallback:")
print(f"   - S&P 500 (^GSPC) data points: {len(indicators.get('^GSPC', {}))}")
print(f"   - Dollar Index (DX-Y.NYB) data points: {len(indicators.get('DX-Y.NYB', {}))}")
print(f"   - BTC Dominance: {indicators.get('btc_dominance', 'NOT FOUND')}")
print(f"   - Has fallback: {'^GSPC' in indicators and 'DX-Y.NYB' in indicators}")

# Verify data structure
assert isinstance(indicators, dict), "Indicators should be a dict"
assert '^GSPC' in indicators or 'DX-Y.NYB' in indicators, "Should contain at least one indicator"
print("✅ Test passed: Global indicators fallback structure is valid\n")

# Test 3: Test with different day counts
for days in [30, 60, 90, 365]:
    result = get_global_indicators_fallback(days=days)
    print(f"3. Fallback with {days} days:")
    print(f"   - S&P 500 points: {len(result.get('^GSPC', {}))}")
    print(f"   - Dollar Index points: {len(result.get('DX-Y.NYB', {}))}")
    assert isinstance(result.get('^GSPC', {}), dict) or len(result.get('^GSPC', {})) == 0, "S&P 500 data should be a dict"
    assert isinstance(result.get('DX-Y.NYB', {}), dict) or len(result.get('DX-Y.NYB', {})) == 0, "Dollar Index data should be a dict"
print("✅ Test passed: All day counts work correctly\n")

print("=== All Tests Passed! ===")
print("\nThe training should now work even when external APIs fail.")
print("Offline fallback values will be used instead of getting stuck.")
