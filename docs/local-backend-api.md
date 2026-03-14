# Local Backend API Contract

NarrateAI can use a **single local server** for all four pipeline steps: story (LLM), TTS, images, and image-to-video. Set `LOCAL_BACKEND_URL` (default `http://localhost:8000`) and choose **Local Backend** for each step in Settings or per automation.

## Base URL

- Env: `LOCAL_BACKEND_URL` (default: `http://localhost:8000`)
- All endpoints are relative to this base.

---

## 1. POST /api/story — Script generation

**Request (JSON)**

- **`prompt`** (string, required): Full scriptwriting prompt (NarrateAI sends the same prompt it uses for other LLMs).
- **`stream`** (boolean, optional): If `true`, the backend streams the response as SSE (`data: {"delta": "token"}\n\n`). NarrateAI uses this by default to avoid proxy timeouts (e.g. Cloudflare 524).
- Optional: `system`, `max_tokens`, or structured fields below.

Structured fields (optional, for backends that build the prompt themselves):

```json
{
  "prompt": "<full scriptwriting prompt>",
  "system": "You are a scriptwriter...",
  "max_tokens": 4096,
  "niche": "science",
  "tone": "dark",
  "artStyle": "cinematic",
  "duration": 60,
  "topic": "optional topic",
  "language": "en",
  "characterPrompt": "optional",
  "avoidThemes": ["theme1"],
  "varietySeed": "optional",
  "sceneCount": 6
}
```

**Response (JSON)** — when `stream` is false or omitted:

```json
{
  "title": "Video title",
  "description": "Short description",
  "hashtags": ["tag1", "tag2"],
  "scenes": [
    { "text": "Narration for scene 1", "visualDescription": "80–120 word image prompt in English" },
    { "text": "Narration for scene 2", "visualDescription": "..." }
  ]
}
```

When **`stream` is true**, the response is **text/event-stream** (SSE). Each event is `data: {"delta": "token"}\n\n`; a final event is `data: {"done": true}\n\n`. The client concatenates all `delta` values and parses the result as JSON. The backend may also return `{"data": { "title", "description", "hashtags", "scenes" }}`; NarrateAI accepts both shapes.

- `scenes` must have exactly `sceneCount` items.
- `text` = voiceover narration; `visualDescription` = prompt for image generation (English).

---

## 2. POST /api/tts — Text-to-speech

**Request (JSON)**

```json
{
  "scriptText": "Full narration text",
  "voiceId": "en-US-GuyNeural",
  "scenes": [{ "text": "Scene 1 narration" }, { "text": "Scene 2 narration" }],
  "language": "en"
}
```

**Response (JSON)**

```json
{
  "audioBase64": "<base64-encoded audio>",
  "mimeType": "audio/wav",
  "durationMs": 45000
}
```

- `audioBase64`: required.
- `mimeType`: optional, `audio/wav` or `audio/mpeg`.
- `durationMs`: optional; if missing, NarrateAI estimates from file size.

---

## 3. POST /api/image — Scene images

**Request (JSON)**

```json
{
  "scenes": [{ "visualDescription": "Scene 1 image prompt" }, { "visualDescription": "..." }],
  "artStylePrompt": "cinematic, moody",
  "negativePrompt": "blurry, low quality"
}
```

**Response (JSON)**

```json
{
  "images": ["<base64 image 1>", "<base64 image 2>", ...]
}
```

- `images`: array of base64 strings (with or without `data:image/...;base64,` prefix).
- Length must be at least the number of scenes.

---

## 4. POST /api/video — Image-to-video (per scene)

**Request (JSON)**

```json
{
  "imageBase64": "<base64-encoded image>",
  "prompt": "Optional motion prompt",
  "durationSec": 5
}
```

**Response**

Either:

- **Binary**: body = video bytes (e.g. `Content-Type: video/mp4`), or  
- **JSON**: `{ "videoBase64": "<base64-encoded video>" }`

NarrateAI calls this once per scene to get a short clip (~5s), then stitches clips into the final video.

---

## Provider selection

- **Settings → Providers**: set default LLM, TTS, Image, and Image-to-Video to **Local Backend**.
- **Automations**: in Edit → AI Provider Overrides, you can choose Local Backend for each step.
- LOCAL_BACKEND is always available (no API key). Use `LOCAL_BACKEND_URL` to override the base URL.

---

## Worker concurrency and local LLM (FIFO)

If you run multiple automations (or “Run now” on several) and use a **local LLM** that handles requests **one at a time** (FIFO), you may see some jobs never get a script or fail at the script step.

**Why:** The video worker runs with **concurrency = 2** by default (`WORKER_CONCURRENCY`). So two jobs can call the local backend’s `/api/story` at the same time. If the backend only serves one request at a time (e.g. one model, one queue), the second request may:

- Wait until the first finishes, then get served (OK), or  
- Hit a timeout (NarrateAI’s `LOCAL_BACKEND_STORY_TIMEOUT_MS`, default 10 min), or  
- Get 503 / connection reset if the backend rejects or drops concurrent requests.

So with 5 jobs and concurrency 2, only the first job is actually being served by the LLM; the second is waiting. If the first takes a long time or the backend misbehaves under concurrency, the waiting job can timeout or error, and later jobs can pile up and fail similarly.

**Fix:** Run the worker with **one job at a time** when using a single-request local LLM:

```bash
WORKER_CONCURRENCY=1 pnpm worker
```

Or set `WORKER_CONCURRENCY=1` in `.env`. Then the worker sends one script request at a time; the local LLM can serve them FIFO and all jobs should get scripts (subject to timeouts). To process more in parallel, the local backend would need to accept and queue multiple requests internally (e.g. a proper queue + workers) instead of handling only one at a time.
