# Architecture — NarrateAI

## 1. System Architecture Overview

The platform consists of five major subsystems that communicate via REST APIs and a job queue.

```
                          ┌─────────────┐
                          │   CDN Edge   │
                          │  (Vercel)    │
                          └──────┬───────┘
                                 │
┌────────────────────────────────▼────────────────────────────────┐
│                        FRONTEND LAYER                          │
│                                                                │
│  Next.js App Router (SSR + CSR)                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────┐ ┌───────┐ │
│  │ Marketing│ │   Auth   │ │Dashboard │ │ Video  │ │ Admin │ │
│  │  Pages   │ │  Pages   │ │  Pages   │ │Preview │ │ Panel │ │
│  └──────────┘ └──────────┘ └──────────┘ └────────┘ └───────┘ │
└────────────────────────────────┬────────────────────────────────┘
                                 │
                    REST API / Server Actions
                                 │
┌────────────────────────────────▼────────────────────────────────┐
│                        BACKEND LAYER                           │
│                                                                │
│  Next.js API Routes + Middleware                               │
│  ┌───────┐ ┌────────┐ ┌────────┐ ┌───────┐ ┌──────────────┐  │
│  │ Auth  │ │ Series │ │ Video  │ │Social │ │   Billing    │  │
│  │Service│ │  CRUD  │ │  Jobs  │ │ OAuth │ │  (Stripe)    │  │
│  └───┬───┘ └───┬────┘ └───┬────┘ └───┬───┘ └──────┬───────┘  │
│      │         │          │          │             │           │
└──────┼─────────┼──────────┼──────────┼─────────────┼───────────┘
       │         │          │          │             │
  ┌────▼─────────▼──┐  ┌───▼───┐  ┌──▼──┐    ┌────▼─────┐
  │   PostgreSQL    │  │ Redis │  │ R2  │    │  Stripe  │
  │   (Prisma ORM) │  │       │  │ /S3 │    │  API     │
  │                 │  │ Cache │  │     │    │          │
  │  Users          │  │   +   │  │Media│    └──────────┘
  │  Series         │  │ Queue │  │Store│
  │  Videos         │  │       │  │     │
  │  SocialAccounts │  └───┬───┘  └──▲──┘
  │  Subscriptions  │      │         │
  └─────────────────┘      │         │
                     ┌─────▼─────────┼───────────────────────┐
                     │       VIDEO WORKER SERVICE            │
                     │                                       │
                     │  BullMQ Consumer Process              │
                     │                                       │
                     │  ┌─────────────────────────────────┐  │
                     │  │ Stage 1: Script Generation      │  │
                     │  │   └─ OpenAI / Claude API        │  │
                     │  ├─────────────────────────────────┤  │
                     │  │ Stage 2: Text-to-Speech         │  │
                     │  │   └─ ElevenLabs / OpenAI TTS    │  │
                     │  ├─────────────────────────────────┤  │
                     │  │ Stage 3: Scene Segmentation     │  │
                     │  │   └─ Timestamp alignment        │  │
                     │  ├─────────────────────────────────┤  │
                     │  │ Stage 4: Image Generation       │  │
                     │  │   └─ Flux / DALL-E / Stability  │  │
                     │  ├─────────────────────────────────┤  │
                     │  │ Stage 5: Video Assembly         │  │
                     │  │   └─ FFmpeg (compose all assets) │  │
                     │  ├─────────────────────────────────┤  │
                     │  │ Stage 6: Upload & Notify        │  │
                     │  │   └─ R2/S3 upload + webhook     │  │
                     │  └─────────────────────────────────┘  │
                     └───────────────────────────────────────┘
                                       │
                     ┌─────────────────▼─────────────────────┐
                     │     SOCIAL POSTING SERVICE            │
                     │                                       │
                     │  Scheduled Cron / BullMQ Repeatable   │
                     │                                       │
                     │  ┌───────────┐ ┌─────────┐ ┌───────┐ │
                     │  │  TikTok   │ │Instagram│ │YouTube│ │
                     │  │Content API│ │Graph API│ │Data v3│ │
                     │  └───────────┘ └─────────┘ └───────┘ │
                     └───────────────────────────────────────┘
```

---

## 2. AI Video Generation Pipeline — Detailed Flow

### 2.1 Pipeline Stages

```
User clicks "Generate Video"
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 1: SCRIPT GENERATION                         │
│                                                     │
│  Input:  niche, topic (optional), series config     │
│  Model:  GPT-4o / Claude 3.5 Sonnet                │
│  Output: {                                          │
│    title: string,                                   │
│    description: string,                             │
│    hashtags: string[],                              │
│    script: string (500-1500 words),                 │
│    scenes: [                                        │
│      { text: string, visual_description: string }   │
│    ]                                                │
│  }                                                  │
│                                                     │
│  Prompt includes:                                   │
│  - Niche-specific tone and vocabulary               │
│  - Hook-body-CTA structure                          │
│  - Scene breakdowns with visual cues                │
│  - Target duration (30s / 60s / 90s)                │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 2: TEXT-TO-SPEECH                            │
│                                                     │
│  Input:  script text, voice_id, speed               │
│  API:    ElevenLabs / OpenAI TTS                    │
│  Output: {                                          │
│    audio_file: Buffer (mp3/wav),                    │
│    duration_ms: number,                             │
│    word_timestamps: [                               │
│      { word: string, start_ms: number,              │
│        end_ms: number }                             │
│    ]                                                │
│  }                                                  │
│                                                     │
│  Notes:                                             │
│  - ElevenLabs provides word-level timestamps        │
│  - OpenAI TTS needs Whisper for alignment           │
│  - Audio stored temporarily in /tmp or memory       │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 3: SCENE SEGMENTATION                        │
│                                                     │
│  Input:  scenes from script, word_timestamps        │
│  Logic:  Map each scene to a time range based on    │
│          word timestamps. Each scene = 4-7 seconds. │
│  Output: [                                          │
│    {                                                │
│      scene_index: number,                           │
│      text: string,                                  │
│      visual_description: string,                    │
│      start_ms: number,                              │
│      end_ms: number,                                │
│      duration_ms: number                            │
│    }                                                │
│  ]                                                  │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 4: IMAGE GENERATION                          │
│                                                     │
│  Input:  scenes[].visual_description, art_style     │
│  API:    Flux (via Fal.ai), fallback: DALL-E 3      │
│  Output: scene_images: Buffer[] (1080x1920 PNG)     │
│                                                     │
│  Prompt template:                                   │
│  "[art_style] style illustration: [visual_desc],    │
│   vertical composition, 9:16 aspect ratio,          │
│   high quality, detailed"                           │
│                                                     │
│  Art styles:                                        │
│  - Pixar 3D, Anime, Realistic, Watercolor,         │
│    Comic Book, Cyberpunk, Oil Painting, Flat Vector │
│                                                     │
│  Notes:                                             │
│  - Parallel generation for all scenes               │
│  - Retry failed generations up to 3 times           │
│  - Fallback to secondary provider on failure        │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 5: VIDEO ASSEMBLY (FFmpeg)                   │
│                                                     │
│  Inputs:                                            │
│  - scene_images[] (1080x1920 PNGs)                  │
│  - audio_file (voiceover MP3)                       │
│  - word_timestamps (for captions)                   │
│  - background_music (optional MP3)                  │
│  - scene timings (start_ms, end_ms per scene)       │
│                                                     │
│  FFmpeg operations:                                 │
│  1. Image → clip: Apply Ken Burns zoom/pan          │
│     (zoompan filter, duration = scene.duration_ms)  │
│  2. Concatenate clips in sequence                   │
│  3. Overlay voiceover audio track                   │
│  4. Mix background music at -15dB under voice       │
│  5. Render animated captions (drawtext filter        │
│     or ASS subtitles with word-by-word highlight)   │
│  6. Add fade transitions between scenes (0.3s)      │
│  7. Encode: H.264, AAC, 1080x1920, 30fps           │
│                                                     │
│  Output: final_video.mp4 (9:16, < 100MB)            │
└─────────────────────┬───────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────┐
│  STAGE 6: UPLOAD & FINALIZE                         │
│                                                     │
│  1. Upload video to R2/S3                           │
│  2. Generate thumbnail (first frame or custom)      │
│  3. Upload thumbnail to R2/S3                       │
│  4. Update Video record in database:                │
│     - video_url, thumbnail_url, duration            │
│     - status → "ready"                              │
│  5. Clean up temporary files                        │
│  6. Send notification (email / in-app / webhook)    │
└─────────────────────────────────────────────────────┘
```

### 2.2 Worker Progress Updates

The worker updates `Video.generation_stage` at the start of each stage so the frontend can show real-time progress:

```
Stage 1 start → UPDATE video SET generation_stage = 'script',   status = 'generating'
Stage 2 start → UPDATE video SET generation_stage = 'tts'
Stage 3 start → (no DB update, runs inline with stage 2)
Stage 4 start → UPDATE video SET generation_stage = 'images'
Stage 5 start → UPDATE video SET generation_stage = 'assembly'
Stage 6 start → UPDATE video SET generation_stage = 'uploading'
Complete      → UPDATE video SET generation_stage = NULL, status = 'ready', video_url = ...
Failed        → UPDATE video SET generation_stage = NULL, status = 'failed', error_message = ...
```

The frontend polls `GET /api/videos/:id` every 3 seconds while `status = 'generating'` and displays the current stage.

### 2.3 Error Handling Strategy

```
Each stage implements:
├── Retry with exponential backoff (max 3 attempts)
├── Stage-level checkpointing (resume from last successful stage)
├── Dead-letter queue for permanently failed jobs
├── Partial cleanup (remove temp files on failure)
└── Update video with error_message on failure
```

---

## 3. Authentication Flow

```
┌──────────┐     ┌──────────────┐     ┌──────────────┐
│  Client  │────▶│ NextAuth.js  │────▶│  PostgreSQL  │
│          │◀────│    v5        │◀────│  User table  │
└──────────┘     └──────┬───────┘     └──────────────┘
                        │
                 ┌──────┼──────┐
                 ▼             ▼
           ┌──────────┐ ┌─────────┐
           │ Email +  │ │ Google  │
           │ Password │ │ OAuth   │
           └──────────┘ └─────────┘
```

### Session Management
- JWT-based sessions stored in httpOnly cookies
- Access token: 15 min expiry
- Refresh token: 7 day expiry
- CSRF protection via double-submit cookie

### User Roles

Three roles stored in `User.role`: `owner`, `admin`, `user` (default).

- **owner** — Platform owner. Bypasses all plan limits. Full admin access. Cannot be deleted or demoted via API. Identified by `OWNER_EMAIL` env var and promoted via seed script.
- **admin** — Staff accounts. Same access as owner except cannot modify the owner account.
- **user** — Regular customers. Subject to plan-based quotas and feature gates.

Admin routes (`/api/admin/*`) are protected by a `requireRole("admin")` middleware that returns 403 for regular users. Plan-gating middleware skips quota checks for owner and admin roles.

---

## 4. Social Media OAuth & Posting Flow

### 4.1 Account Connection Flow

```
User clicks "Connect TikTok"
         │
         ▼
┌─────────────────────────────────────┐
│  1. Redirect to platform OAuth URL  │
│     with app client_id + scopes     │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  2. User authorizes on platform     │
│     (TikTok / Instagram / YouTube)  │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  3. Platform redirects to callback  │
│     with authorization code         │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  4. Exchange code for access +      │
│     refresh tokens                  │
│  5. Store encrypted in DB           │
│  6. Fetch user profile info         │
└─────────────────────────────────────┘
```

### 4.2 Auto-Posting Flow

```
Cron job runs every 15 minutes
         │
         ▼
┌─────────────────────────────────────┐
│  1. Query videos with status=ready  │
│     and scheduled_post_time <= now  │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  2. For each video, check which     │
│     platforms the series is set to  │
│     auto-post to                    │
└─────────────────┬───────────────────┘
                  │
         ┌───────┼────────┐
         ▼       ▼        ▼
    ┌────────┐┌────────┐┌────────┐
    │TikTok  ││Insta   ││YouTube │
    │Direct  ││Container││Data   │
    │Post API││Upload  ││API v3 │
    └───┬────┘└───┬────┘└───┬────┘
        │         │         │
        ▼         ▼         ▼
┌─────────────────────────────────────┐
│  3. Update video.posted_platforms   │
│     with post IDs and timestamps    │
│  4. Update status → "posted"        │
│  5. Log result for analytics        │
└─────────────────────────────────────┘
```

---

## 5. Data Flow Diagram

```
                   ┌──────────────┐
                   │   Browser    │
                   └──────┬───────┘
                          │
                   ┌──────▼───────┐
                   │   Vercel     │
                   │   (Next.js)  │
                   └──────┬───────┘
                          │
              ┌───────────┼───────────┐
              │           │           │
       ┌──────▼──┐  ┌────▼────┐ ┌───▼─────┐
       │Read Ops │  │Write Ops│ │Job Queue│
       │(cached) │  │         │ │(BullMQ) │
       └────┬────┘  └────┬────┘ └────┬────┘
            │            │           │
       ┌────▼────┐  ┌────▼────┐ ┌───▼──────┐
       │  Redis  │  │Postgres │ │  Worker   │
       │  Cache  │  │   DB    │ │ Process   │
       └─────────┘  └─────────┘ └────┬─────┘
                                     │
                    ┌────────────────┬┼──────────────┐
                    │                │               │
              ┌─────▼────┐   ┌──────▼───┐   ┌──────▼──────┐
              │ AI APIs  │   │  FFmpeg  │   │ R2/S3       │
              │ (LLM,TTS │   │ Process  │   │ (media      │
              │  ImgGen) │   │          │   │  storage)   │
              └──────────┘   └──────────┘   └─────────────┘
```

---

## 6. Deployment Architecture

### Development
```
Local machine
├── Next.js dev server (port 3000)
├── PostgreSQL (Docker or local)
├── Redis (Docker or local)
├── Worker process (separate terminal)
└── FFmpeg (installed via brew/apt)
```

### Staging / Production
```
Vercel (Frontend + API Routes)
├── Edge network for static assets
├── Serverless functions for API
└── Environment variables managed via dashboard

Railway / Fly.io (Workers)
├── Video generation worker (long-running)
├── Social posting worker (cron-based)
└── Scales horizontally based on queue depth

Supabase / Neon (PostgreSQL)
├── Connection pooling via PgBouncer
└── Automatic backups

Upstash (Redis)
├── Serverless Redis for queue + cache
└── Global replication

Cloudflare R2 (Media Storage)
├── S3-compatible API
├── Zero egress fees
└── CDN-backed delivery
```

---

## 7. Security Considerations

| Area | Approach |
|------|----------|
| Authentication | JWT in httpOnly cookies, CSRF double-submit tokens |
| Password Storage | bcrypt hashing (cost factor 12), never stored in plaintext |
| Role Authorization | `role` field on User model, `requireRole()` middleware on admin routes |
| Owner Account | Identified by `OWNER_EMAIL` env var, promoted via seed script. No credentials in env. |
| Social OAuth Tokens | AES-256 encrypted at rest in DB |
| API Keys | Server-side only, never exposed to client bundle |
| Rate Limiting | Per-user limits on generation endpoints, bypassed for owner/admin |
| Input Validation | Zod schemas on all API inputs |
| SQL Injection | Prisma parameterized queries (no raw SQL) |
| XSS Prevention | React auto-escaping + Content-Security-Policy headers |
| File Upload | MIME type validation, size limits (100MB max) |
| CORS | Strict origin allowlist |
| Webhook Verification | Stripe signature verification on all webhook endpoints |

---

## 8. Monitoring & Observability

```
┌──────────────────────────────────────────┐
│              Monitoring Stack            │
│                                          │
│  Sentry ──── Error tracking + alerts     │
│  Plausible ─ Web analytics (privacy-ok)  │
│  BullMQ UI ─ Job queue dashboard         │
│  Vercel ──── Deployment logs + analytics │
│  Uptime ──── Health check monitoring     │
└──────────────────────────────────────────┘
```

### Health Check Endpoint
`GET /api/health` returns:
```json
{
  "status": "ok",
  "db": "connected",
  "redis": "connected",
  "queue": { "waiting": 5, "active": 2, "completed": 1234 },
  "timestamp": "2026-02-17T00:00:00Z"
}
```
