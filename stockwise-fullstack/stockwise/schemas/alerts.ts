import { z } from "zod";

export const alertCreateSchema = z.object({
  symbol: z.string().min(1).max(20),
  target_price: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  direction: z.enum(["above", "below"]),
});

export const webhookSchema = z.object({
  passphrase: z.string(),
  symbol: z.string().min(1),
  action: z.string().min(1),
  price: z.union([z.number(), z.string()]),
  msg: z.string().optional().default(""),
});
