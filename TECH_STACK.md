# Tech Stack — NarrateAI

## Decision Matrix

Every technology was chosen based on: **developer experience**, **cost efficiency**, **scalability**, and **ecosystem maturity**.

---

## Frontend

| Technology | Version | Purpose | Why This |
|-----------|---------|---------|----------|
| **Next.js** | 14+ (App Router) | Full-stack React framework | SSR/SSG for SEO, API routes, server actions, same as original site |
| **TypeScript** | 5.x | Type safety | Catch bugs early, better DX with autocomplete |
| **Tailwind CSS** | 3.x | Utility-first styling | Rapid UI development, consistent design system |
| **shadcn/ui** | latest | Component library | Accessible, customizable, copy-paste components (not a dependency) |
| **Framer Motion** | 11.x | Animations | Landing page animations, transitions, scroll effects |
| **React Hook Form** | 7.x | Form management | Performant forms with validation (series wizard, settings) |
| **Zod** | 3.x | Schema validation | Shared validation between client and server |
| **TanStack Query** | 5.x | Client-side data fetching | Cache, optimistic updates, polling for job status |
| **Lucide React** | latest | Icons | Consistent icon set, tree-shakeable |

---

## Backend

| Technology | Version | Purpose | Why This |
|-----------|---------|---------|----------|
| **Next.js API Routes** | 14+ | Primary API layer | Co-located with frontend, serverless-ready |
| **Prisma** | 5.x | ORM / Database toolkit | Type-safe queries, migrations, studio GUI |
| **NextAuth.js** | 5.x (v5) | Authentication | Built for Next.js, supports OAuth + credentials |
| **BullMQ** | 5.x | Job queue | Redis-based, robust retry logic, progress tracking |
| **Zod** | 3.x | API input validation | Runtime type checking on all endpoints |

---

## AI Services

| Service | Purpose | Why This | Fallback |
|---------|---------|----------|----------|
| **OpenAI GPT-4o** | Script generation | Best quality for creative writing | Anthropic Claude 3.5 Sonnet |
| **Anthropic Claude** | Script generation (alt) | Strong narrative writing | OpenAI GPT-4o |
| **ElevenLabs** | Text-to-Speech | Natural voices, word-level timestamps | OpenAI TTS |
| **OpenAI TTS** | Text-to-Speech (alt) | Cheaper, good quality | ElevenLabs |
| **Flux (via Fal.ai)** | Image generation | Fast, high quality, cost effective | DALL-E 3 |
| **DALL-E 3** | Image generation (alt) | Excellent prompt following | Stability AI SDXL |
| **OpenAI Whisper** | Audio alignment | Word-level timestamps if TTS doesn't provide | AssemblyAI |

### Cost Estimates Per Video (60s, 8 scenes)

| Stage | Service | Est. Cost |
|-------|---------|-----------|
| Script | GPT-4o (1K tokens out) | $0.01 |
| TTS | ElevenLabs (1000 chars) | $0.03 |
| Images | Flux x 8 images | $0.04 |
| **Total per video** | | **~$0.08** |

---

## Database & Storage

| Technology | Purpose | Why This |
|-----------|---------|----------|
| **PostgreSQL** | Primary database | Robust, relational, JSON support for flexible fields |
| **Prisma** | ORM layer | Type-safe, auto-generated client, great migration system |
| **Redis (Upstash)** | Cache + job queue backend | Serverless-friendly, BullMQ compatible, global replication |
| **Cloudflare R2** | Media file storage | S3-compatible, zero egress fees, built-in CDN |

### Database Hosting Options

| Provider | Free Tier | Paid | Best For |
|----------|-----------|------|----------|
| **Supabase** | 500MB, 2 projects | $25/mo | Full Postgres + extras |
| **Neon** | 512MB, branching | $19/mo | Serverless Postgres |
| **Railway** | $5 credits/mo | Usage-based | Simple deploy |
| **PlanetScale** | Deprecated MySQL | — | Not recommended |

**Recommendation:** Supabase for Postgres (free tier is generous, includes auth as bonus backup).

---

## Video Processing

| Technology | Purpose | Why This |
|-----------|---------|----------|
| **FFmpeg** | Video assembly, encoding, filters | Industry standard, free, extremely capable |
| **fluent-ffmpeg** | Node.js FFmpeg wrapper | Readable API for building FFmpeg commands |
| **sharp** | Image processing | Resize, crop, format conversion before FFmpeg |

### FFmpeg Capabilities Used

- `zoompan` filter — Ken Burns effect on still images
- `drawtext` filter — Animated caption overlay
- `amix` filter — Mix voiceover + background music
- `concat` demuxer — Join scene clips sequentially
- `xfade` filter — Cross-fade transitions between scenes
- H.264 encoding with AAC audio, 9:16 aspect ratio

---

## Payments

| Technology | Purpose | Why This |
|-----------|---------|----------|
| **Stripe** | Subscriptions & payments | Industry standard, excellent API, webhooks |
| **Stripe Checkout** | Payment page | Hosted checkout, PCI compliant, no custom form |
| **Stripe Customer Portal** | Self-service billing | Users manage plans, invoices, payment methods |

### Plan Structure

| Plan | Price | Videos/mo | Series | Platforms | Features |
|------|-------|-----------|--------|-----------|----------|
| Free | $0 | 3 | 1 | 0 | 2 basic art styles, 2 standard voices |
| Starter | $19/mo | 30 | 5 | 1 | All art styles, standard voices |
| Pro | $49/mo | 100 | 20 | 3 | All art styles, premium voices, analytics |
| Agency | $99/mo | 300 | Unlimited | Unlimited | All features, priority queue |

---

## Email

| Technology | Purpose | Why This |
|-----------|---------|----------|
| **Resend** | Transactional email | Modern API, React email templates, generous free tier |
| **React Email** | Email templates | Build emails with React components |

---

## Deployment & Hosting

| Service | Purpose | Why This |
|---------|---------|----------|
| **Vercel** | Frontend + API hosting | Zero-config Next.js deploy, edge network, preview deploys |
| **Railway** | Worker processes | Long-running process support, easy Docker deploys |
| **Fly.io** | Worker processes (alt) | Global edge deployment, Machines API |
| **Docker** | Worker containerization | Consistent environment with FFmpeg pre-installed |

### Why Not All on Vercel?
Vercel serverless functions have a **60s timeout** (Pro plan). Video generation takes 2-5 minutes, so workers must run on a platform supporting long-running processes.

---

## Monitoring & Analytics

| Technology | Purpose | Why This |
|-----------|---------|----------|
| **Sentry** | Error tracking | Automatic error capture, stack traces, alerts |
| **Plausible** | Web analytics | Privacy-first, lightweight, no cookies |
| **BullMQ Board** | Queue monitoring | Built-in dashboard for job status |
| **Vercel Analytics** | Performance monitoring | Web vitals, serverless function metrics |

---

## Development Tools

| Tool | Purpose |
|------|---------|
| **ESLint** | Code linting |
| **Prettier** | Code formatting |
| **Husky** | Git hooks (pre-commit) |
| **lint-staged** | Run linters on staged files only |
| **Vitest** | Unit testing |
| **Playwright** | E2E testing |
| **Docker Compose** | Local dev dependencies (Postgres, Redis) |

---

## Package Manager

**pnpm** — Faster installs, disk-efficient, strict dependency resolution.

---

## Summary: Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Monorepo vs polyrepo | **Monorepo** (single Next.js app + workers dir) | Simpler to manage, shared types |
| REST vs tRPC vs GraphQL | **REST** (Next.js API routes) | Simple, cacheable, well-understood |
| CSS approach | **Tailwind + shadcn/ui** | Fastest development, great defaults |
| Auth solution | **NextAuth.js v5** | Native Next.js, flexible, free |
| Queue system | **BullMQ + Redis** | Battle-tested, rich features |
| Primary AI provider | **OpenAI** (with multi-provider fallback) | Best ecosystem, reliable APIs |
| Image generation | **Flux via Fal.ai** (primary) | Best price/quality, fast |
| Storage | **Cloudflare R2** | Zero egress, S3-compatible |
| Hosting split | **Vercel** (web) + **Railway** (workers) | Best of both: edge + long-running |
