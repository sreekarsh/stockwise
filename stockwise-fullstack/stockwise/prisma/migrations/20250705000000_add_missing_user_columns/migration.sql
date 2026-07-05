-- Add missing columns to users table that exist in schema.prisma but were not in initial migration
ALTER TABLE "users" ADD COLUMN "font_style" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "tracker_font" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "avatar_accessory" TEXT NOT NULL DEFAULT '';
