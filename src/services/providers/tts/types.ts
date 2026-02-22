export interface TTSResult {
  audioPath: string;
  durationMs: number;
  sceneTimings: { startMs: number; endMs: number }[];
}

export interface TtsProviderInterface {
  generateSpeech(
    scriptText: string,
    voiceId: string,
    scenes: { text: string }[]
  ): Promise<TTSResult>;
}
