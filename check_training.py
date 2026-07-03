import os, json, time

training_status_path = "/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/training_status.json"
if os.path.exists(training_status_path):
    try:
        with open(training_status_path, "r") as f:
            data = json.load(f)
        print("=== ML Training Status ===")
        print(f"is_training: {data.get('is_training')}")
        print(f"Current model: {data.get('current_model')}")
        if data.get('started_at'):
            start_ms = data['started_at']
            now_ms = int(time.time() * 1000)
            elapsed_ms = now_ms - start_ms
            elapsed_min = elapsed_ms / 60000
            print(f"Started: {start_ms}")
            print(f"Elapsed: {elapsed_min:.1f} minutes")
            remaining_est = 45 - elapsed_min
            print(f"Estimated remaining: {max(0, remaining_est):.1f} minutes")
        if data.get('logs'):
            logs = data.get('logs')
            print(f"Recent logs: {logs[-2:] if len(logs) > 2 else logs}")
        if data.get('fold_progress'):
            fp = data['fold_progress']
            print(f"Fold progress: {fp.get('current')} / {fp.get('total')} folds")
    except Exception as e:
        print(f"Error reading status: {e}")
else:
    print("Training status file not found")