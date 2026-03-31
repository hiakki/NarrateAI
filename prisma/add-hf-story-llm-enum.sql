-- Add HF story LLM provider enum values to existing LlmProvider type.
-- Run once with: psql $DATABASE_URL -f prisma/add-hf-story-llm-enum.sql
-- Or: npx prisma db execute --file prisma/add-hf-story-llm-enum.sql

ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_ZEPHYR';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_MISTRAL_INSTRUCT';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_PHI2';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_LLAMA_TINY';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_SMOLLAMA';
ALTER TYPE "LlmProvider" ADD VALUE 'HF_STORY_QWEN_7B';
