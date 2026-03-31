export interface ImageGenResult {
  imagePaths: string[];
  tmpDir: string;
}

export interface ImageGenOptions {
  scenes: { visualDescription: string }[];
  artStylePrompt: string;
  negativePrompt?: string;
  sceneCount?: number;
}

export type OnImageProgress = (index: number, imagePath: string) => void | Promise<void>;

export interface ImageGenCallOptions {
  aspectRatio?: "9:16" | "16:9";
}

export interface ImageProviderInterface {
  generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    negativePrompt?: string,
    onProgress?: OnImageProgress,
    options?: ImageGenCallOptions,
  ): Promise<ImageGenResult>;
}
