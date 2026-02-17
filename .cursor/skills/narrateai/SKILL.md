---
name: narrateai
description: Guides development of NarrateAI — an AI faceless video generation platform. Use when working on video generation pipeline, social media auto-posting, series management, landing page, dashboard, FFmpeg video assembly, TTS integration, or any feature of this project.
---

# NarrateAI — Development Skill

## Project Context

Building a full-stack AI video generation platform (NarrateAI). Users create "series" by picking a niche, the AI generates scripts, voiceovers, images, assembles videos via FFmpeg, and auto-posts to TikTok/Instagram/YouTube.

## Key References

- **Plan:** [PLAN.md](../../../PLAN.md) — phases, features, DB schema, API endpoints
- **Architecture:** [ARCHITECTURE.md](../../../ARCHITECTURE.md) — system design, pipeline stages, data flow
- **Tech Stack:** [TECH_STACK.md](../../../TECH_STACK.md) — technology choices and rationale

## Tech Stack Quick Reference

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14+ (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Database | PostgreSQL via Prisma |
| Cache/Queue | Redis (Upstash) + BullMQ |
| Auth | NextAuth.js v5 |
| Payments | Stripe |
| Storage | Cloudflare R2 |
| AI | OpenAI (scripts), ElevenLabs (TTS), Flux/Fal.ai (images) |
| Video | FFmpeg via fluent-ffmpeg |
| Deploy | Vercel (web) + Railway (workers) |
| Package Manager | pnpm |

## Code Conventions

### File Naming
- Components: `PascalCase.tsx` (e.g., `VideoPreview.tsx`)
- Utilities/services: `kebab-case.ts` (e.g., `script-generator.ts`)
- API routes: `route.ts` inside appropriate App Router directory
- Types: `kebab-case.ts` in `src/types/`

### Component Pattern
```tsx
// Always use named exports, not default exports
export function ComponentName({ prop1, prop2 }: ComponentNameProps) {
  // ...
}

// Co-locate types with the component or in src/types/
interface ComponentNameProps {
  prop1: string;
  prop2: number;
}
```

### API Route Pattern
```ts
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getServerSession } from "@/lib/auth";
import { db } from "@/lib/db";

const requestSchema = z.object({ /* ... */ });

export async function POST(req: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = requestSchema.parse(await req.json());
  // ... business logic
  return NextResponse.json({ data: result });
}
```

### Service Pattern (AI Pipeline)
```ts
// Each pipeline stage is a standalone service in src/services/
export async function generateScript(input: ScriptInput): Promise<ScriptOutput> {
  // 1. Validate input
  // 2. Call AI API
  // 3. Parse and validate output
  // 4. Return typed result
}
```

### Database Operations
```ts
// Always use Prisma client from src/lib/db.ts
import { db } from "@/lib/db";

// Use transactions for multi-step operations
const result = await db.$transaction(async (tx) => {
  const series = await tx.series.create({ data: { ... } });
  const video = await tx.video.create({ data: { seriesId: series.id, ... } });
  return { series, video };
});
```

## Folder Structure

```
src/
├── app/
│   ├── (marketing)/     # Landing, pricing, blog (public)
│   ├── (auth)/          # Login, register
│   ├── (dashboard)/     # Protected dashboard pages
│   └── api/             # API routes
├── components/
│   ├── ui/              # shadcn/ui primitives
│   ├── landing/         # Marketing page sections
│   ├── dashboard/       # Dashboard-specific
│   └── shared/          # Reusable across groups
├── lib/                 # Utilities (db, auth, stripe, storage)
├── services/            # AI pipeline services
├── hooks/               # React hooks
├── types/               # TypeScript types
└── config/              # Constants and config
workers/                 # BullMQ worker processes
```

## Video Pipeline Stages (in order)

1. **Script Generation** — LLM creates script with scene breakdowns
2. **Text-to-Speech** — Convert script to audio with timestamps
3. **Scene Segmentation** — Map scenes to time ranges
4. **Image Generation** — Generate images per scene in chosen art style
5. **Video Assembly** — FFmpeg stitches everything together
6. **Upload & Finalize** — Upload to R2, update DB, notify user

## Roles & Permissions

Three roles in `User.role`: `owner`, `admin`, `user` (default).

- **owner/admin**: Bypass all plan limits, access admin panel at `/admin/*`
- **user**: Subject to plan-based quotas and feature gates
- Owner is identified by `OWNER_EMAIL` env var, promoted via seed script (no credentials in env)
- Owner cannot be deleted or demoted via API
- Admin API routes use `requireRole("admin")` middleware
- Plan-gating checks use `isPrivilegedRole(user.role)` to skip limits for owner/admin

## Common Tasks

### Adding a new niche
1. Add niche to `src/config/niches.ts`
2. Add prompt template to `src/services/script-generator.ts`
3. Add niche icon/thumbnail to `public/images/niches/`

### Adding a new art style
1. Add style config to `src/config/art-styles.ts`
2. Add style prompt modifier to `src/services/image-generator.ts`
3. Add preview thumbnail to `public/images/styles/`

### Adding a new social platform
1. Create OAuth route in `src/app/api/social-accounts/`
2. Add platform posting logic to `src/services/social-poster.ts`
3. Add platform to `SocialAccount` Prisma model
4. Update dashboard UI in `src/components/dashboard/`

### Adding a new admin page
1. Create page in `src/app/(admin)/admin/<feature>/page.tsx`
2. Add API route in `src/app/api/admin/<feature>/route.ts` with `requireRole("admin")`
3. Add nav link in admin layout sidebar

## Error Handling

- All API routes: wrap in try/catch, return proper HTTP status codes
- AI services: retry 3x with exponential backoff, fallback to secondary provider
- BullMQ jobs: configure `attempts: 3`, `backoff: { type: 'exponential', delay: 5000 }`
- Client-side: use error boundaries + toast notifications

## Environment Variables

See `.env.example` for the full list. Critical ones:
- `DATABASE_URL` — Postgres connection string
- `REDIS_URL` — Redis connection string
- `OWNER_EMAIL` — Account matching this email gets owner role via seed script
- `OPENAI_API_KEY` — For script generation
- `ELEVENLABS_API_KEY` — For TTS
- `STRIPE_SECRET_KEY` — For billing
- `R2_*` or `S3_*` — For media storage
