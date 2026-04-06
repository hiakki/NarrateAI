import fs from "fs/promises";
import path from "path";
import os from "os";
import type { ImageProviderInterface, ImageGenResult, OnImageProgress } from "./types";
import { createLogger } from "@/lib/logger";
import { generateFlowStoryAssets } from "@/services/flow-tv";
import { getFlowCookieFilePath } from "@/lib/flow-cookie-path";

const log = createLogger("Image:FlowTV");

export class FlowTvImageProvider implements ImageProviderInterface {
  async generateImages(
    scenes: { visualDescription: string }[],
    _artStylePrompt: string,
    _negativePrompt?: string,
    onProgress?: OnImageProgress,
    _options?: import("./types").ImageGenCallOptions,
  ): Promise<ImageGenResult> {
    const cookiePath = getFlowCookieFilePath();
    if (!cookiePath) {
      throw new Error("Flow cookies not found. Upload JSON cookies at /api/settings/flow-cookies first.");
    }
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "narrateai-flow-img-"));
    const limited = scenes.slice(0, 2); // current hard safety for test/learning
    const results = await generateFlowStoryAssets({
      videoId: `flow-${Date.now()}`,
      projectName: `narrateai-flow-${Date.now()}`,
      scenes: limited.map((s, i) => ({
        sceneIndex: i,
        sceneName: `scene-${String(i + 1).padStart(2, "0")}`,
        imagePrompt: s.visualDescription,
        clipPrompt: s.visualDescription,
        durationSec: 6,
      })),
      outputDir: tmpDir,
      maxScenes: 2,
    });
    const imagePaths = results.map((r) => r.sceneImagePath);
    for (let i = 0; i < imagePaths.length; i++) {
      await onProgress?.(i, imagePaths[i]);
    }
    log.log(`Flow TV generated ${imagePaths.length} scene image(s)`);
    return { imagePaths, tmpDir };
  }
}
