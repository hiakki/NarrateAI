# NarrateAI

AI-powered faceless video generation platform that automatically creates and publishes short-form videos to Instagram Reels, YouTube Shorts, and Facebook Reels.

---

## What It Does

1. **Pick a niche** — Choose from mythology, scary stories, history, anime, and more
2. **AI generates everything** — Script, voiceover, images, and full video assembly
3. **Auto-posts for you** — Connects to Instagram Reels, YouTube Shorts, Facebook Reels and posts on schedule

## Project Documentation

| Document | Description |
|----------|-------------|
| [PLAN.md](./PLAN.md) | Full project plan with phases, features, DB schema, API endpoints |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, AI pipeline details, data flow diagrams |
| [TECH_STACK.md](./TECH_STACK.md) | Technology decisions with rationale and alternatives |

## Tech Stack

- **Frontend:** Next.js 14+, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes, Prisma, PostgreSQL, Redis, BullMQ
- **AI Pipeline:** Gemini/OpenAI/DeepSeek (scripts), ElevenLabs/Edge TTS (TTS), Leonardo/DALL-E/Flux (images), FFmpeg (assembly)
- **Payments:** Stripe
- **Storage:** Cloudflare R2
- **Deploy:** Vercel (web) + Railway (workers)

## Getting Started

### Prerequisites

- Node.js 20+
- pnpm 8+
- PostgreSQL 15+
- Redis 7+
- FFmpeg 6+
- API keys (OpenAI, ElevenLabs, Stripe, etc.)

### Setup

```bash
# Clone the repository
git clone <repo-url>
cd narrateai

# Install dependencies
pnpm install

# Copy environment variables
cp .env.example .env.local
# Fill in your API keys in .env.local

# Start local Postgres and Redis (requires Docker)
docker compose up -d

# Setup database
pnpm prisma generate
pnpm prisma db push
pnpm prisma db seed    # Promotes OWNER_EMAIL to owner role

# Start development server
pnpm dev

# In a separate terminal, start the worker
pnpm worker
```

### Environment Variables

See `.env.example` for the full list of required environment variables.

### Social Media Setup

To enable auto-posting, you need OAuth credentials for each platform.

#### Instagram Reels & Facebook Reels (same Meta app)

1. Go to [Meta for Developers](https://developers.facebook.com/) and create a new app (type: **Business**)
2. Add the **Facebook Login** product to the app
3. Under Facebook Login > Settings, add your OAuth redirect URI:
   ```
   {YOUR_APP_URL}/api/social/callback/meta
   ```
4. Request these permissions: `instagram_basic`, `instagram_content_publish`, `pages_show_list`, `pages_manage_posts`, `pages_read_engagement`
5. Copy the **App ID** and **App Secret** from Settings > Basic into your `.env`:
   ```
   FACEBOOK_APP_ID=your_app_id
   FACEBOOK_APP_SECRET=your_app_secret
   ```
6. Your Instagram account must be a **Professional account** (Business or Creator) linked to a Facebook Page

> Docs: [Instagram Graph API - Content Publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing) | [Facebook Reels API](https://developers.facebook.com/docs/video-api/guides/reels-publishing)

#### YouTube Shorts

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create a project (or reuse existing)
2. Enable the **YouTube Data API v3** under APIs & Services > Library
3. Create OAuth 2.0 credentials: APIs & Services > Credentials > Create Credentials > OAuth client ID (type: **Web application**)
4. Add your redirect URI:
   ```
   {YOUR_APP_URL}/api/social/callback/youtube
   ```
5. Copy the **Client ID** and **Client Secret** into your `.env`:
   ```
   YOUTUBE_CLIENT_ID=your_client_id
   YOUTUBE_CLIENT_SECRET=your_client_secret
   ```
6. If you already have `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` set for Google sign-in, you can reuse those -- just enable YouTube Data API v3 on the same project

> Docs: [YouTube Data API - Uploading a Video](https://developers.google.com/youtube/v3/docs/videos/insert) | [Google OAuth 2.0 Setup](https://developers.google.com/identity/protocols/oauth2/web-server)

#### Token Encryption Key

`SOCIAL_TOKEN_SECRET` is used to encrypt OAuth tokens at rest (AES-256-GCM). Generate one with:

```bash
openssl rand -hex 32
```

### Running the Scheduler

To enable scheduled auto-generation and auto-posting, run the scheduler alongside the worker:

```bash
# Terminal 1: Next.js dev server
pnpm dev

# Terminal 2: Video generation worker
pnpm worker

# Terminal 3: Schedule checker (runs every 5 minutes)
pnpm scheduler
```

## Project Structure

```
src/
├── app/              # Next.js App Router pages & API
├── components/       # React components (schedule-editor, channel-selector, etc.)
├── lib/              # Utilities (db, auth, social/encrypt, social/instagram, etc.)
├── services/         # AI pipeline services (video-assembler, social-poster, etc.)
├── hooks/            # React hooks
├── types/            # TypeScript types
└── config/           # Constants (providers, niches, art-styles, voices)
workers/
├── video-generation.ts   # BullMQ worker: TTS → Images → Assembly → Auto-post
└── scheduler.ts          # Cron: checks schedules, auto-generates & posts videos
prisma/               # Database schema
```

## Development Phases

1. **Foundation** — Project setup, auth, database
2. **Landing Page** — Marketing site with all sections
3. **Dashboard** — Series management, video preview
4. **AI Pipeline** — Script → TTS → Images → Video assembly
5. **Social Integration** — OAuth + auto-posting
6. **Billing** — Stripe subscriptions
7. **Analytics** — Performance tracking
8. **Launch** — Testing, security, deployment

## License

Private — All rights reserved.
