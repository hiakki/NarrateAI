-- AlterTable: add master kill-switch for viral-clips automation on User.
-- When FALSE, scheduler.optimizeClipAutomations + processAutomation refuse
-- to touch this user's clip-repurpose automations (no auto-enabling
-- tomorrow even if user manually pauses each row today).
ALTER TABLE "users"
  ADD COLUMN "clipRepurposeAutomationEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable: add per-automation Flow-TV config snapshot.
-- Used by the scheduler when this row fires (automationType = 'flow-tv')
-- to construct the createRun({...}) payload with the user's preferred
-- imageCount / language / characterStyle / aspectRatio / dialogue / bgm /
-- sfx / subtitles / storylineSource / useRecurringCharacter / veoVariant.
-- NULL preserves prior behaviour (hard-coded defaults in scheduler).
ALTER TABLE "automations"
  ADD COLUMN "flowTvConfig" JSONB;
