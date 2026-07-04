export interface ScheduledRetrainPayload {
  model: "gbm" | "lstm" | "ppo" | "all";
  days: number;
  horizon: number;
  lookback: number;
  threshold: number;
  min_samples: number;
}

export function buildScheduledRetrainPayload(): ScheduledRetrainPayload {
  return {
    model: "gbm",
    days: 90,
    horizon: 4,
    lookback: 60,
    threshold: 0.5,
    min_samples: 5000,
  };
}
