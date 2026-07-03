import os, json, time, signal, subprocess

training_status_path = '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/training_status.json'
print('=== ML Training Status ===')

# Check if training status shows training is in progress
if os.path.exists(training_status_path):
    with open(training_status_path, 'r') as f:
        data = json.load(f)
    is_training = data.get('is_training', False)
    current_model = data.get('current_model', 'Unknown')
    started_at = data.get('started_at')
    
    print(f'Current model: {current_model}')
    print(f'is_training: {is_training}')
    
    if started_at:
        now = int(time.time() * 1000)
        elapsed = (now - started_at) / 60000
        print(f'Elapsed time: {elapsed:.1f} minutes')
        
        # Check recent logs
        logs = data.get('logs', [])
        print(f'Total log entries: {len(logs)}')
        
        if len(logs) > 5:
            print('Recent logs (last 5):')
            for log in logs[-5:]:
                print(f"  {log}")
        
        # Check if training might be hung
        if is_training and elapsed > 30:
            print(f'\n⚠️ WARNING: Training may be stuck!')
            print(f'Elapsed: {elapsed:.1f} minutes, this is unusually long for early training phase.')
            
            # Check for hung Python processes
            try:
                import psutil
                python_processes = [p for p in psutil.process_iter(['pid', 'name']) if 'python' in p.info['name'].lower()]
                print(f'Active Python processes: {len(python_processes)}')
                for p in python_processes:
                    print(f'  - PID {p.info["pid"]}: {p.info["name"]}')
            except Exception as e:
                print(f'Could not check processes: {e}')
                
            print(f'\nRECOMMENDED ACTION:')
            print(f'1. Check if trainer_v3.py process is still running')
            print(f'2. Consider killing the stuck training process')
            print(f'3. The training has been running for {elapsed:.1f} minutes and appears to be stuck at step 1b/6')
    
else:
    print('❌ Training status file not found')

print('\n=== Checking other training indicators ===')
trainer_py_path = '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/trainer.py'
if os.path.exists(trainer_py_path):
    print(f'✓ trainer.py exists')
    with open(trainer_py_path, 'r') as f:
        content = f.read()
        if 'logging.basicConfig' in content:
            print('✓ trainer.py has logging configured')
else:
    print('❌ trainer.py not found', trainer_py_path)

# Check for any ML related processes
print('\n=== ML Related Files Check ===')
ml_files = [
    '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/training_status.json',
    '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/trainer.py',
    '/Users/admin/Music/trail3.1/stockwise-fullstack/stockwise/ml_engine/retrain_pipeline.py'
]

for file in ml_files:
    exists = os.path.exists(file)
    print(f"{'✓' if exists else '❌'} {os.path.basename(file)}")
