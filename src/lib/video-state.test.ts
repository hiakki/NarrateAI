import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { deriveVideoStatusFromPlatforms, shouldPromoteVideoToPosted } from "@/lib/video-state";
import type { PlatformEntry } from "@/lib/platform-utils";

describe("video-state helpers", () => {
  it("promotes posted only when all targeted are terminal success", () => {
    const entries: PlatformEntry[] = [
      { platform: "YOUTUBE", success: true },
      { platform: "FACEBOOK", success: "deleted" },
      { platform: "INSTAGRAM", success: "scheduled" },
    ];
    assert.equal(shouldPromoteVideoToPosted(entries, ["YOUTUBE", "FACEBOOK", "INSTAGRAM"]), false);
    entries[2].success = true;
    assert.equal(shouldPromoteVideoToPosted(entries, ["YOUTUBE", "FACEBOOK", "INSTAGRAM"]), true);
  });

  it("derives scheduled and ready status correctly", () => {
    const scheduled: PlatformEntry[] = [{ platform: "YOUTUBE", success: "scheduled" }];
    assert.equal(deriveVideoStatusFromPlatforms("READY", scheduled, ["YOUTUBE"]), "SCHEDULED");

    const none: PlatformEntry[] = [{ platform: "YOUTUBE", success: false }];
    assert.equal(deriveVideoStatusFromPlatforms("SCHEDULED", none, ["YOUTUBE"]), "READY");
  });
});

