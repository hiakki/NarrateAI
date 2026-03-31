# Hugging Face: token vs enabling models

## Why do I need to "enable" models if I already set `HF_TOKEN`?

Hugging Face uses **two separate things**:

1. **Your API token** (`HUGGINGFACE_API_KEY` / `HUGGINGFACE_API_TOKEN` / `HF_TOKEN`)  
   - Proves who you are.  
   - Required for every request.  
   - You set this in `.env`.

2. **Inference Providers** (account setting on HF)  
   - Controls **which models are allowed to run** for your account.  
   - HF does not run every model by default; you choose which providers (e.g. “Hugging Face”, “Fal”, etc.) are enabled.  
   - This is configured **once** at:  
     **https://huggingface.co/settings/inference-providers**

If the token is set but a model is not enabled there, you get errors like:

- `The requested model 'X' is not supported by any provider you have enabled`
- `Model not available` / 404

So: **token = auth**, **Inference Providers = which models you’re allowed to use**. Both are required; the app cannot enable providers for you.

## What to do (one-time)

1. Put your HF token in `.env` (you already did).
2. Open **https://huggingface.co/settings/inference-providers**.
3. Enable at least one provider that serves the model you use (e.g. the one that serves `Qwen/Qwen2.5-7B-Instruct` for story, or the one for your TTS/image model).
4. Save. After that, you shouldn’t need to change it unless you switch to a different model.

No need to “ask again” in the app — once providers are enabled for the models you use, the token is enough.
