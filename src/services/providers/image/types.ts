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

export interface ImageProviderInterface {
  generateImages(
    scenes: { visualDescription: string }[],
    artStylePrompt: string,
    negativePrompt?: string,
  ): Promise<ImageGenResult>;
}
