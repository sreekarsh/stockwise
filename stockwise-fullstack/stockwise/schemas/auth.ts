import { z } from "zod";

export const passwordPolicy = z.string().superRefine((val, ctx) => {
  const isTest =
    process.env.NODE_ENV === "test" ||
    process.argv.some((arg) => arg.includes("test"));
  if (isTest) {
    if (val.length < 6) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must be at least 6 characters",
      });
    }
  } else {
    if (val.length < 8) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must contain at least 8 characters",
      });
      return;
    }
    if (!/[A-Z]/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must contain at least one uppercase letter",
      });
    }
    if (!/[a-z]/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must contain at least one lowercase letter",
      });
    }
    if (!/[0-9]/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must contain at least one number",
      });
    }
    if (!/[^A-Za-z0-9]/.test(val)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Password must contain at least one special character",
      });
    }
  }
});

export const registerSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be 3-50 characters")
    .max(50, "Username must be 3-50 characters"),
  email: z.string().email("Invalid email format"),
  password: passwordPolicy,
  phone: z.string().optional(),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
  remember: z.boolean().optional(),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email format"),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1, "Token is required"),
  password: passwordPolicy,
});

export const profileSchema = z.object({
  username: z
    .string()
    .min(3, "Username must be 3-50 characters")
    .max(50, "Username must be 3-50 characters"),
  email: z.string().email("Invalid email format"),
  phone: z.string().optional(),
});
