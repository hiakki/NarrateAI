-- AlterTable
ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "stageTimings" JSONB;
