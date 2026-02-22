export interface ScriptInput {
  niche: string;
  tone: string;
  artStyle: string;
  duration: number;
  topic?: string;
  language?: string;
}

export interface Scene {
  text: string;
  visualDescription: string;
}

export interface GeneratedScript {
  title: string;
  description: string;
  hashtags: string[];
  scenes: Scene[];
  fullScript: string;
}

export interface LlmProviderInterface {
  generateScript(input: ScriptInput): Promise<GeneratedScript>;
}
