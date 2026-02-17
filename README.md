# NarrateAI

AI-powered faceless video generation platform that automatically creates and publishes short-form videos to TikTok, Instagram, and YouTube.

---

## What It Does

1. **Pick a niche** — Choose from mythology, scary stories, history, anime, and more
2. **AI generates everything** — Script, voiceover, images, and full video assembly
3. **Auto-posts for you** — Connects to TikTok, Instagram, YouTube and posts on schedule

## Project Documentation

| Document | Description |
|----------|-------------|
| [PLAN.md](./PLAN.md) | Full project plan with phases, features, DB schema, API endpoints |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System architecture, AI pipeline details, data flow diagrams |
| [TECH_STACK.md](./TECH_STACK.md) | Technology decisions with rationale and alternatives |

## Tech Stack

- **Frontend:** Next.js 14+, TypeScript, Tailwind CSS, shadcn/ui
- **Backend:** Next.js API Routes, Prisma, PostgreSQL, Redis, BullMQ
- **AI Pipeline:** OpenAI (scripts), ElevenLabs (TTS), Flux (images), FFmpeg (assembly)
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

## Project Structure

```
src/
├── app/              # Next.js App Router pages & API
├── components/       # React components
├── lib/              # Utilities (db, auth, storage)
├── services/         # AI pipeline services
├── hooks/            # React hooks
├── types/            # TypeScript types
└── config/           # Constants
workers/              # BullMQ worker processes
prisma/               # Database schema & migrations
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
