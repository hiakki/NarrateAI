# Image-to-video for shorts/reels

NarrateAI can turn **scene images into short video clips** (typically 4–10 seconds each) and stitch them with voiceover and captions into your final short. This uses image-to-video models so each scene has motion instead of Ken Burns only.

## Important: 30–90 second length

Most image-to-video generators output **short clips (about 4–10 seconds) per run**. For 30–90 second final videos you can:

1. **Use per-scene mode in NarrateAI** — Enable `USE_IMAGE_TO_VIDEO=SVD_REPLICATE`. Each scene image is turned into a clip, then assembled with your voiceover. Total length is driven by your script/voiceover; clips are trimmed to fit each scene.
2. **Generate several clips elsewhere and stitch in an editor** — Use the recommended Hugging Face Spaces below to create multiple clips, then edit them together in CapCut, DaVinci Resolve, etc.

So treat these as **“best generators for clips you’ll edit into shorts/reels”** when used outside the app, or as **per-scene animation** when used inside the app.

## Enabling in NarrateAI

1. Set `REPLICATE_API_TOKEN` (same as for Flux/Kolors).
2. Set in `.env` or `.env.local`:
   ```bash
   USE_IMAGE_TO_VIDEO=SVD_REPLICATE
   ```
3. Trigger a video as usual. After images are generated, each scene is sent to Stable Video Diffusion; successful clips are used in assembly, failed scenes fall back to the static image with Ken Burns.

Cost is roughly **~$0.18 per clip** (Replicate SVD). A 6-scene video with all clips enabled is about ~$1.08 extra.

## Recommended external Spaces (image → video)

These Hugging Face Spaces are solid options for shorts/reels (cosmos, anime, scary, etc.). They run on Zero GPU or similar; free tier has a ~3.5 min GPU/day limit.

| Space | Why it fits |
|-------|-------------|
| **Wan2.2 Animate (Wan-AI)** | Top likes, image + text → video. Strong for varied, high-quality motion (cosmos, anime, scary). [Space](https://huggingface.co/spaces/Wan-AI/Wan2.2-Animate) |
| **Wan2.2 14B Fast (zerogpu-aoti)** | Same family, “Fast” variant. Good balance of quality and speed for many clips. [Space](https://huggingface.co/spaces/zerogpu-aoti/Wan2.2-14B-Fast) |
| **Stable Video Diffusion 1.1 (multimodalart)** | Single image → short video. Simple, reliable, works for many styles. [Space](https://huggingface.co/spaces/multimodalart/stable-video-diffusion-1-1) |
| **LTX Video Fast (Lightricks)** | Very fast, image + text. Good for cranking out lots of 5–10s clips. [Space](https://huggingface.co/spaces/Lightricks/LTX-Video-Fast) |
| **Wan 2 2 First Last Frame (multimodalart)** | Start image + end image → video in between. Great for “cosmos → explosion,” “normal → scary.” [Space](https://huggingface.co/spaces/multimodalart/Wan-2-2-First-Last-Frame) |
| **ToonCrafter (Doubiiu)** | Two cartoon images → animated clip. Best for anime/cartoon style reels. [Space](https://huggingface.co/spaces/Doubiiu/ToonCrafter) |

### Quick pick by priority

- **Main workhorse:** Wan2.2 Animate or Wan2.2 14B Fast — image + prompt, flexible for cosmos, anime, scary, and general shorts.
- **Anime/cartoon focus:** ToonCrafter — two images → one animated clip.
- **Controlled “before → after”:** Wan 2 2 First Last Frame — start/end image for clear story beats.
- **Speed / volume:** LTX Video Fast or Stable Video Diffusion 1.1 — fast iterations for many clips.

For 30–90s final videos, plan on generating several clips per reel and editing them together in your usual tool, or use NarrateAI’s per-scene mode with `USE_IMAGE_TO_VIDEO=SVD_REPLICATE`.
