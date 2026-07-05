-- Add missing columns to users table that exist in schema.prisma but were not in initial migration
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "font_style" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "tracker_font" TEXT NOT NULL DEFAULT '';
