import { z } from "zod";

export const trainSchema = z.object({
  model: z.enum(["gbm", "lstm", "ppo", "all"]).optional().default("gbm"),
  days: z.number().int().min(15).max(365).optional().default(90),
  horizon: z.number().int().min(1).max(24).optional().default(4),
  lookback: z.number().int().min(10).max(200).optional().default(60),
  threshold: z.number().min(0).max(100).optional().default(0.5),
  min_samples: z
    .number()
    .int()
    .min(100)
    .max(50000)
    .optional()
    .default(5000),
});
