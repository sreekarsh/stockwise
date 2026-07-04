-- AlterTable: add avatar_finish column to users table
ALTER TABLE "users" ADD COLUMN "avatar_finish" TEXT NOT NULL DEFAULT 'solid';
