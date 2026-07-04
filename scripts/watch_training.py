import json, time, sys, os
p = os.path.join(r"C:\Users\admin\Music\trail3.1\stockwise-fullstack\stockwise\ml_engine","training_status.json")
print("Starting training watcher for:", p)
while True:
    try:
        with open(p, 'r', encoding='utf-8') as f:
            j = json.load(f)
    except Exception as e:
        print("Could not read status, retrying...", e)
        time.sleep(5)
        continue
    if not j.get('is_training'):
        print('TRAINING_FINISHED')
        print(json.dumps(j, indent=2))
        break
    else:
        cur = j.get('fold_progress', {}).get('current')
        tot = j.get('fold_progress', {}).get('total')
        print(f'TRAINING_RUNNING {cur}/{tot} {time.strftime("%Y-%m-%d %H:%M:%S")}')
        sys.stdout.flush()
        time.sleep(10)
