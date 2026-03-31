# Unique story per video – changes summary

So every automation run produces a **different story** instead of repeating the same premise (e.g. "gravity stopped").

## What was changed

### 1. **Single-pass always gets an explicit topic** (`src/services/script-generator.ts`)
- **Before:** When two-pass was disabled (default), the LLM was called with no topic → it often picked the same idea (e.g. "what if gravity stopped").
- **After:** We always build topic candidates (shuffled by `varietySeed`), pick the first one, and pass it as `topic` so each run gets a **different** topic from the niche pool.

### 2. **Better shuffle seed** (`src/services/script-generator.ts`)
- Added `seedFromVarietySeed()` so the topic list is shuffled using a hash of the full `varietySeed` string (timestamp + video id), not just the last few characters. Each run gets a different order and thus a different chosen topic.

### 3. **Worker passes variety seed + avoid-themes** (`workers/video-generation.ts`)
- Before generating the script, the worker:
  - Fetches the **last 6 video titles** for the same series (excluding the current video).
  - Passes them as **`avoidThemes`** so the prompt tells the model not to repeat those premises.
  - Passes **`varietySeed`** = `timestamp-videoId` so the topic shuffle and prompt uniqueness line change every run.

### 4. **Retry route also gets variety** (`src/app/api/videos/[id]/retry/route.ts`)
- When regenerating script on retry, we now pass `avoidThemes` (recent titles in the series) and `varietySeed` so retries also get a unique topic.

### 5. **Prompt instructions** (`src/services/providers/llm/prompt.ts`)
- **UNIQUENESS** block: story must be unique; avoid overused tropes; pick a fresh angle.
- **AVOID THESE THEMES** line when `avoidThemes` is present.
- **Variety seed** line so the model is nudged to a non-obvious premise for this run.

### 6. **Niche topic pools** (`src/config/niches.ts`)
- **What-if:** 3 → 15 sample topics (e.g. “What if the internet vanished forever”, “What if time ran backward for one day”).
- **Science-facts / Mythology:** more sample topics so the shuffled pool has more variety.

### 7. **Temperature and narrative variety (story still similar)**
- **Gemini** was not setting `temperature`, so it often defaulted to 0 → nearly identical stories. Script generation now uses `temperature: 0.95` for Gemini.
- **All LLM providers** (OpenAI, DeepSeek, Qwen, Local): script generation temperature increased from 0.9 to **0.95** for more variety.
- **Per-run narrative constraint**: From `varietySeed` we pick one of 10 fixed “story shape” rules (e.g. “Open with a shocking statistic”, “Start in the middle of the action”, “Use a countdown structure”) and add it to the prompt as “THIS SCRIPT ONLY (narrative constraint)”. So each run is forced to use a **different opening/structure**, not just a different topic — the story itself should feel different.

---

## What you need to do

1. **Restart the video-generation worker**  
   It runs in a separate process. Restart it so it loads the new code (worker that fetches `avoidThemes`, passes `varietySeed`, and the script-generator that picks an explicit topic in single-pass).

   ```bash
   # If you run the worker with pnpm/node, stop it and start again, e.g.:
   pnpm run worker
   # or
   node workers/video-generation.js
   ```

2. **Trigger a new video** from the automation (or retry a video so it regenerates the script).  
   New runs will get a topic from the shuffled list + avoid-themes + uniqueness instructions.

---

## Files touched

| File | Change |
|------|--------|
| `src/services/script-generator.ts` | Single-pass uses one topic from shuffled candidates; `seedFromVarietySeed()` for shuffle |
| `workers/video-generation.ts` | Fetches recent titles, passes `avoidThemes` and `varietySeed` into script input |
| `src/app/api/videos/[id]/retry/route.ts` | Passes `avoidThemes` and `varietySeed` when regenerating script on retry |
| `src/services/providers/llm/prompt.ts` | UNIQUENESS block, avoidThemes line, varietySeed line |
| `src/services/providers/llm/types.ts` | `avoidThemes?: string[]`, `varietySeed?: string` on `ScriptInput` |
| `src/config/niches.ts` | More sample topics for what-if, science-facts, mythology |
