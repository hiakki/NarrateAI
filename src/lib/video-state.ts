import { VideoStatus } from "@prisma/client";
import type { PlatformEntry } from "@/lib/platform-utils";

export const POSTED_PLATFORM_STATES = new Set<PlatformEntry["success"]>([true, "deleted"]);

export function isTerminalSuccessState(success: PlatformEntry["success"]): boolean {
  return POSTED_PLATFORM_STATES.has(success);
}

export function shouldPromoteVideoToPosted(
  entries: PlatformEntry[],
  targetPlatforms: string[],
): boolean {
  if (entries.length === 0) return false;
  if (targetPlatforms.length > 0) {
    return targetPlatforms.every((platform) => {
      const entry = entries.find((e) => e.platform === platform);
      return !!entry && isTerminalSuccessState(entry.success);
    });
  }
  return entries.every((e) => isTerminalSuccessState(e.success));
}

export function deriveVideoStatusFromPlatforms(
  currentStatus: VideoStatus,
  entries: PlatformEntry[],
  targetPlatforms: string[],
): VideoStatus {
  if (shouldPromoteVideoToPosted(entries, targetPlatforms)) return "POSTED";
  if (entries.some((e) => e.success === "scheduled")) return "SCHEDULED";
  if (entries.some((e) => e.success === true)) return currentStatus === "SCHEDULED" ? "SCHEDULED" : "POSTED";
  return currentStatus === "POSTED" || currentStatus === "SCHEDULED" ? "READY" : currentStatus;
}
