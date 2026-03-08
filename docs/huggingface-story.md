# Hugging Face Story (script) generation

NarrateAI can use the **Hugging Face Inference API** as a free LLM option for **story/script generation**. Supported languages: **English** and **Hindi**.

Multiple **storywriter models** are configured; the app picks the **best model and temperature** per niche, tone, and ambience (response quality, mood fit, creativity level).

## Model selection (automatic)

When you use **Hugging Face Story** as the script provider, the app:

- **Resolves the best model** for the current niche and tone (e.g. Scary Stories + dramatic → Mistral 7B Instruct; Science Facts + educational → Phi-2).
- **Sets temperature** per model (e.g. higher for creative/dramatic, lower for factual/educational).
- **Scores by ambience** using the niche’s mood keywords (from prompt enhancers) so the chosen model fits the intended vibe.

Configured models (see `src/config/story-models.ts`). Only models with an [Inference Provider](https://huggingface.co/settings/inference-providers) (e.g. featherless-ai) are included:

| Model | Backend / note | Best for | Temperature |
|-------|----------------|----------|-------------|
| **Zephyr 7B** | HuggingFaceH4/zephyr-7b-beta | Default when nothing else scores higher | 0.92 |
| **Mistral 7B Instruct** | mistralai/Mistral-7B-Instruct-v0.2 | Dramatic niches (scary, true crime, mythology, motivation, etc.) | 0.95 |
| **Phi-2** | Qwen/Qwen2.5-7B-Instruct (phi-2 has no provider) | Educational/casual (science, what-if, history, life-hacks) | 0.88 |
| **TinyLlama** | Qwen/Qwen2.5-1.5B-Instruct (TinyLlama not on router) | Funny/casual (funny stories, anime recaps, satisfying) | 0.97 |

Enable at least one provider (e.g. **featherless-ai**) at [Inference Providers](https://huggingface.co/settings/inference-providers) so the router can serve these models.

You can still **force a single model** with `HF_STORY_MODEL` (see below).

1. Create a Hugging Face account and a token with **read** access:  
   [https://huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)

2. In `.env` or `.env.local` set:
   ```bash
   HUGGINGFACE_API_KEY=your_token_here
   ```
   You can also use `HUGGINGFACE_API_TOKEN` or `HF_TOKEN`; the app checks all three.

3. In the app, go to **Settings** or the **Create** flow and choose **Hugging Face Story** as the script (LLM) provider. It appears in the list only when `HUGGINGFACE_API_KEY` (or one of the other env vars) is set.

## Languages

- **English** (`en`) — default.
- **Hindi** (`hi`) — narration, title, description, and hashtags are generated in Hindi; `visualDescription` stays in English for image generation.

Language is selected per automation or in the create flow; the same HF provider is used for both.

## Model

By default the app **picks a model per niche/tone/ambience** (see “Model selection” above).

To **force a single model** for all requests, set:

```bash
HF_STORY_MODEL=HuggingFaceH4/zephyr-7b-beta
```

or any [text-generation model on the Hub](https://huggingface.co/models?pipeline_tag=text-generation). Temperature will still come from the story-models config when the model is known, otherwise 0.92.

## Related

- [Hugging Face Spaces (story / text generation)](https://huggingface.co/spaces?category=text-generation&q=story) — optional inspiration or alternative models.
- Script prompt and structure are the same as for other LLM providers (Gemini, OpenAI, etc.); only the API endpoint and model change.
