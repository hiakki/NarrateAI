-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'ADMIN', 'USER');

-- CreateEnum
CREATE TYPE "UserPlan" AS ENUM ('FREE', 'STARTER', 'PRO', 'AGENCY');

-- CreateEnum
CREATE TYPE "SeriesStatus" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "VideoStatus" AS ENUM ('QUEUED', 'GENERATING', 'REVIEW', 'READY', 'SCHEDULED', 'POSTED', 'FAILED');

-- CreateEnum
CREATE TYPE "GenerationStage" AS ENUM ('SCRIPT', 'TTS', 'IMAGES', 'ASSEMBLY', 'UPLOADING');

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('INSTAGRAM', 'YOUTUBE', 'FACEBOOK', 'SHARECHAT', 'MOJ');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELED');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('GEMINI_FLASH', 'OPENAI_GPT4O_MINI', 'DEEPSEEK_V3', 'QWEN', 'LOCAL_LLM', 'HF_STORY', 'HF_STORY_ZEPHYR', 'HF_STORY_MISTRAL_INSTRUCT', 'HF_STORY_PHI2', 'HF_STORY_LLAMA_TINY', 'HF_STORY_SMOLLAMA', 'HF_STORY_QWEN_7B');

-- CreateEnum
CREATE TYPE "TtsProvider" AS ENUM ('GEMINI_TTS', 'ELEVENLABS', 'COSYVOICE', 'FISH_AUDIO', 'EDGE_TTS', 'HF_TTS');

-- CreateEnum
CREATE TYPE "ImageProvider" AS ENUM ('GEMINI_IMAGEN', 'DALLE3', 'FLUX', 'KOLORS', 'SDXL', 'FLUX_SCHNELL', 'TOGETHER', 'SILICONFLOW', 'LEONARDO', 'IDEOGRAM', 'POLLINATIONS', 'HF_IMAGE');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT,
    "avatarUrl" TEXT,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "plan" "UserPlan" NOT NULL DEFAULT 'FREE',
    "stripeCustomerId" TEXT,
    "defaultLlmProvider" "LlmProvider",
    "defaultTtsProvider" "TtsProvider",
    "defaultImageProvider" "ImageProvider",
    "defaultImageToVideoProvider" TEXT,
    "lastCreatePrefs" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_verifications" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "series" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "artStyle" TEXT NOT NULL DEFAULT 'realistic',
    "musicType" TEXT,
    "musicUrl" TEXT,
    "voiceId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'dramatic',
    "status" "SeriesStatus" NOT NULL DEFAULT 'ACTIVE',
    "characterId" TEXT,
    "llmProvider" "LlmProvider",
    "ttsProvider" "TtsProvider",
    "imageProvider" "ImageProvider",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "niche" TEXT NOT NULL,
    "artStyle" TEXT NOT NULL DEFAULT 'realistic',
    "voiceId" TEXT,
    "language" TEXT NOT NULL DEFAULT 'en',
    "tone" TEXT NOT NULL DEFAULT 'dramatic',
    "duration" INTEGER NOT NULL DEFAULT 45,
    "characterId" TEXT,
    "llmProvider" "LlmProvider",
    "ttsProvider" "TtsProvider",
    "imageProvider" "ImageProvider",
    "targetPlatforms" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includeAiTags" BOOLEAN NOT NULL DEFAULT true,
    "frequency" TEXT NOT NULL DEFAULT 'daily',
    "postTime" TEXT NOT NULL DEFAULT '09:00',
    "timezone" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "seriesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "videos" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "scriptText" TEXT,
    "scenesJson" JSONB,
    "voiceoverUrl" TEXT,
    "videoUrl" TEXT,
    "thumbnailUrl" TEXT,
    "duration" INTEGER,
    "targetDuration" INTEGER,
    "status" "VideoStatus" NOT NULL DEFAULT 'QUEUED',
    "generationStage" "GenerationStage",
    "scheduledPostTime" TIMESTAMP(3),
    "postedPlatforms" JSONB NOT NULL DEFAULT '[]',
    "errorMessage" TEXT,
    "checkpointData" JSONB,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "insights" JSONB,
    "insightsRefreshedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "videos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "characters" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'human',
    "physical" TEXT,
    "clothing" TEXT,
    "accessories" TEXT,
    "features" TEXT,
    "personality" TEXT,
    "fullPrompt" TEXT NOT NULL,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "characters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "pageId" TEXT,
    "pageName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "username" TEXT,
    "profileUrl" TEXT,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tokenExpiresAt" TIMESTAMP(3),
    "metrics" JSONB,
    "metricsRefreshedAt" TIMESTAMP(3),
    "metricsBaseline" JSONB,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_settings" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "enabledLlmProviders" JSONB NOT NULL DEFAULT '["GEMINI_FLASH","OPENAI_GPT4O_MINI","DEEPSEEK_V3","QWEN"]',
    "enabledTtsProviders" JSONB NOT NULL DEFAULT '["GEMINI_TTS","ELEVENLABS","COSYVOICE","FISH_AUDIO","EDGE_TTS","HF_TTS"]',
    "enabledImageProviders" JSONB NOT NULL DEFAULT '["GEMINI_IMAGEN","DALLE3","FLUX","KOLORS","SDXL","FLUX_SCHNELL","TOGETHER","SILICONFLOW","LEONARDO","IDEOGRAM","POLLINATIONS","HF_IMAGE"]',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripePriceId" TEXT,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "email_verifications_email_code_idx" ON "email_verifications"("email", "code");

-- CreateIndex
CREATE INDEX "email_verifications_email_expiresAt_idx" ON "email_verifications"("email", "expiresAt");

-- CreateIndex
CREATE INDEX "series_userId_idx" ON "series"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "automations_seriesId_key" ON "automations"("seriesId");

-- CreateIndex
CREATE INDEX "automations_userId_idx" ON "automations"("userId");

-- CreateIndex
CREATE INDEX "automations_enabled_idx" ON "automations"("enabled");

-- CreateIndex
CREATE INDEX "videos_seriesId_idx" ON "videos"("seriesId");

-- CreateIndex
CREATE INDEX "videos_status_idx" ON "videos"("status");

-- CreateIndex
CREATE INDEX "characters_userId_idx" ON "characters"("userId");

-- CreateIndex
CREATE INDEX "social_accounts_userId_idx" ON "social_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_userId_platform_platformUserId_key" ON "social_accounts"("userId", "platform", "platformUserId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_userId_key" ON "subscriptions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "series" ADD CONSTRAINT "series_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "characters"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automations" ADD CONSTRAINT "automations_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "videos" ADD CONSTRAINT "videos_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "characters" ADD CONSTRAINT "characters_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

