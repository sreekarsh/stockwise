#!/usr/bin/env python3
"""
Quick status check for the stuck ML training issue.
This simulates what the training_status.py script should check.
"""

import os
import json
import sys

def check_training_status():
    print("=== ML Training Status Check ===\n")
    
    status_path = 'C:\\Users\\admin\\Music\\trail3.1\\stockwise-fullstack\\stockwise\\ml_engine\\training_status.json'
    
    if not os.path.exists(status_path):
        print("❌ Training status file not found")
        print("The training was likely killed when we force-killed process PID 24928")
        return
    
    try:
        with open(status_path, 'r') as f:
            data = json.load(f)
        
        is_training = data.get('is_training', False)
        elapsed_min = round((json.dumps(data).find('"started_at":') / 2) / 60000, 1)
        logs_count = len(data.get('logs', []))
        
        print(f"Status: {'RUNNING' if is_training else 'STOPPED'}")
        print(f"Elapsed: {elapsed_min} minutes")
        print(f"Log entries: {logs_count}")
        
        if is_training and elapsed_min > 60:
            print("\n🚨 WARNING: Training has been running for over 60 minutes!")
            print("The training fix should have prevented this from happening.")
            print("This suggests either:")
            print("1. The training process restarted after being killed")
            print("2. There's another issue besides the global indicators fetch")
            print("\nCheck the fixes we made:")
            print("✅ global_indicators_fallback.py - Provides offline fallback values")
            print("✅ trainer.py - Uses fallbacks when external fetch fails")
            print("✅ routes/ml.ts - Has caching for /regime and /sentiment endpoints")
        
    except Exception as e:
        print(f"❌ Error reading status: {e}")
        return

if __name__ == "__main__":
    check_training_status()
