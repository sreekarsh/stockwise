import os, json, time

training_status_path = '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/training_status.json'
if os.path.exists(training_status_path):
    with open(training_status_path, 'r') as f:
        data = json.load(f)
    print('=== ML Training Status ===')
    current_model = data.get('current_model')
    print('Current model:', current_model)
    if data.get('started_at'):
        start_ms = data['started_at']
        now_ms = int(time.time() * 1000)
        elapsed_min = (now_ms - start_ms) / 60000
        remaining_est = 45 - elapsed_min
        print('Progress:', f'{elapsed_min:.1f} / 45 minutes')
        print('Remaining:', f'{max(0, remaining_est):.1f} minutes')
        elapsed_rounded = round(elapsed_min)
        print()
        print('=== Summary ===')
        print('Training phase:', current_model)
        print('ETA: Completion in approximately', f'{max(0, remaining_est):.1f}', 'minutes')
        print('Elapsed:', f'{elapsed_rounded} minutes')
        print('Progress: ~', f'{min(100, int(elapsed_min / 0.45 * 100))}%')
else:
    print('Training status file not found')