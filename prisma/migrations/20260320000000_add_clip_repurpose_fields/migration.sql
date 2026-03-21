-- AlterTable: add clip-repurpose fields to automations
ALTER TABLE "automations" ADD COLUMN "automationType" TEXT NOT NULL DEFAULT 'original';
ALTER TABLE "automations" ADD COLUMN "clipConfig" JSONB;

-- AlterTable: add source tracking fields to videos
ALTER TABLE "videos" ADD COLUMN "sourceUrl" TEXT;
ALTER TABLE "videos" ADD COLUMN "sourceMetadata" JSONB;
