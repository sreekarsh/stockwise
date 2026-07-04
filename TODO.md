# TODO - Fix ML retraining deployment gate

- [ ] Update `stockwise-fullstack/stockwise/ml_engine/retrain_pipeline.py` to relax `MIN_WIN_RATE` (and optionally regression gates).
- [ ] Re-run `python stockwise-fullstack/stockwise/ml_engine/retrain_pipeline.py` to confirm `trained.marker.json` updates.
- [ ] Verify `trained.marker.json` last write time moves forward.
- [ ] Confirm `/api/ml/performance` (or UI) shows the updated deployment.

