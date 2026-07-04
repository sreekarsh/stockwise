import { z } from "zod";

export const postSchema = z.object({
  content: z.string().min(1).max(500),
  coin: z.string().optional().default(""),
  group_id: z
    .union([z.number(), z.string()])
    .transform(Number)
    .optional()
    .nullable(),
  recipient_id: z
    .union([z.number(), z.string()])
    .transform(Number)
    .optional()
    .nullable(),
});

export const groupCreateSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional().default(""),
});

export const friendIdSchema = z.object({
  friend_id: z.union([z.number(), z.string()]).transform(Number),
});

export const avatarUpdateSchema = z.object({
  name: z.string().max(100).optional().default(""),
  bg_color: z.string().optional().default("#00e5a0"),
  texture: z.string().optional().default("solid"),
  accessory: z.string().optional().default("none"),
  energy: z.string().optional().default("none"),
  finish: z.string().optional().default("solid"),
});
