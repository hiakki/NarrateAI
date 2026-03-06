export interface ScriptInput {
  niche: string;
  tone: string;
  artStyle: string;
  duration: number;
  topic?: string;
  language?: string;
  characterPrompt?: string;
  /** Recent video titles/premises to avoid repeating (e.g. from same automation). */
  avoidThemes?: string[];
  /** Optional seed (e.g. timestamp) to encourage unique output per run. */
  varietySeed?: string;
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
  expandText?(text: string, targetWords: number): Promise<string>;
}
