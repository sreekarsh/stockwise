import { z } from "zod";

export const addHoldingSchema = z.object({
  symbol: z.string().min(1, "Symbol is required").max(20, "Symbol too long").transform(s => s.toUpperCase()),
  name: z.string().min(1, "Name is required").max(100, "Name too long"),
  quantity: z.number().positive("Quantity must be positive").finite("Quantity must be a finite number"),
  buy_price: z.number().min(0, "Buy price cannot be negative").finite("Buy price must be a finite number").default(0),
  asset_type: z.enum(["crypto", "stock", "etf"]).default("crypto"),
});

export const editHoldingSchema = z.object({
  quantity: z.number().positive("Quantity must be positive").finite("Quantity must be a finite number").optional(),
  buy_price: z.number().min(0, "Buy price cannot be negative").finite("Buy price must be a finite number").optional(),
});
