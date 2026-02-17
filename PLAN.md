# NarrateAI — Project Plan

## 1. Project Overview

Build an AI-powered faceless video generation platform that automatically creates and publishes short-form videos (Reels/Shorts/TikToks) across social media platforms. Users select a niche, customize art style and music, and the platform handles script writing, voiceover, image generation, video assembly, and auto-posting.

---

## 2. Core Features

### 2.1 User-Facing Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Landing Page | Marketing site with hero, testimonials, how-it-works, FAQ | P0 |
| Auth System | Sign up, login, OAuth (Google), password reset | P0 |
| Dashboard | Overview of series, videos, analytics | P0 |
| Series Creation | Create a "series" by choosing niche, format, art style | P0 |
| Video Generation | AI pipeline: script → TTS → images → video assembly | P0 |
| Video Preview | Watch generated video before publishing | P0 |
| Customization | Art styles, music upload, TikTok sound links, captions | P1 |
| Social Account Linking | Connect TikTok, Instagram, YouTube accounts via OAuth | P1 |
| Auto-Posting | Scheduled and automatic posting to connected platforms | P1 |
| Analytics Dashboard | Views, subscribers, engagement per channel/video | P2 |
| Billing & Plans | Subscription management via Stripe | P1 |
| Blog / Content Pages | SEO content, guides, tips | P2 |
| Admin Panel | User management, video moderation, system health | P1 |
| Role-Based Access | Owner/admin bypass all limits, admin route protection | P0 |

### 2.2 AI Video Pipeline Features

| Feature | Description | Priority |
|---------|-------------|----------|
| Script Generation | LLM generates engaging scripts from niche + topic | P0 |
| Text-to-Speech | Convert script to voiceover with multiple voice options | P0 |
| Scene Segmentation | Split script into timed scenes (5-6s each) | P0 |
| Image Generation | Generate images per scene in chosen art style | P0 |
| Video Assembly | FFmpeg: stitch images + audio + captions + transitions | P0 |
| Caption/Subtitle Overlay | Auto-generated animated captions synced to audio | P0 |
| Multi-Language Support | TTS and scripts in 10+ languages | P2 |
| Background Music Mixing | Layer background music under voiceover | P1 |

---

## 3. Technical Architecture Summary

> Full details in [ARCHITECTURE.md](./ARCHITECTURE.md)

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Next.js)                  │
│   Landing Page │ Dashboard │ Video Editor │ Settings    │
└───────────────────────┬─────────────────────────────────┘
                        │ REST API
┌───────────────────────▼─────────────────────────────────┐
│                   BACKEND (Next.js API / Node.js)       │
│   Auth │ Series CRUD │ Video Jobs │ Social OAuth │ Pay  │
└───────┬──────────┬──────────┬───────────────────────────┘
        │          │          │
   ┌────▼───┐ ┌───▼────┐ ┌──▼──────────────────────┐
   │Postgres│ │ Redis  │ │   Job Queue (BullMQ)    │
   │(Prisma)│ │ Cache  │ │                         │
   └────────┘ └────────┘ └──────────┬──────────────┘
                                    │
                    ┌───────────────▼──────────────┐
                    │      VIDEO WORKER SERVICE    │
                    │                              │
                    │  1. Script Gen (OpenAI/Claude)│
                    │  2. TTS (ElevenLabs/OpenAI)  │
                    │  3. Image Gen (Flux/DALL-E)  │
                    │  4. FFmpeg Assembly           │
                    │  5. Upload to S3/R2          │
                    └──────────────────────────────┘
                                    │
                    ┌───────────────▼──────────────┐
                    │   SOCIAL POSTING SERVICE     │
                    │                              │
                    │  TikTok API │ IG API │ YT API│
                    └──────────────────────────────┘
```

---

## 4. Phase-by-Phase Development Plan

### Phase 1 — Foundation (Week 1-2)

- [ ] Initialize Next.js 14+ project with App Router
- [ ] Setup Tailwind CSS, shadcn/ui component library
- [ ] Create docker-compose.yml (Postgres 15 + Redis 7)
- [ ] Setup PostgreSQL + Prisma ORM with initial schema
- [ ] Setup Redis instance
- [ ] Setup authentication (NextAuth.js v5)
  - Email + password (credentials provider)
  - Google OAuth provider
  - Register page + custom `/api/auth/register` route
- [ ] Create project structure and folder conventions
- [ ] Setup ESLint, Prettier, Husky pre-commit hooks
- [ ] Setup environment variable management (.env.example)
- [ ] Create database seed script with owner account (prisma/seed.ts)
- [ ] Implement role-based middleware (owner/admin/user)
- [ ] Setup package.json scripts: `dev`, `build`, `worker`, `seed`, `studio`
- [ ] Deploy staging environment (Vercel + Railway/Supabase)

### Phase 2 — Landing Page & Marketing Site (Week 2-3)

- [ ] Hero section with animated CTA
- [ ] Niche ticker/carousel animation
- [ ] Social proof section (channel analytics cards)
- [ ] Comparison table (why choose us)
- [ ] Testimonials carousel (auto-scrolling)
- [ ] How-it-works 3-step section
- [ ] Demo video embed section
- [ ] FAQ accordion section
- [ ] Footer with links
- [ ] Mobile responsive design
- [ ] SEO meta tags, Open Graph, structured data

### Phase 3 — User Dashboard (Week 3-5)

- [ ] Dashboard layout with sidebar navigation
- [ ] Series list page (cards showing each series)
- [ ] Create Series wizard:
  - Step 1: Choose niche (predefined + custom)
  - Step 2: Choose video format and duration
  - Step 3: Choose art style (gallery picker)
  - Step 4: Configure music (optional — skip for v1, use default or none)
  - Step 5: Auto-posting (optional — disabled until social accounts connected in Phase 5)
- [ ] Individual Series page with:
  - List of generated videos with status badges
  - "Generate Video" button → triggers job, shows loading state
- [ ] Video detail page with:
  - Video player (plays from R2/S3 URL)
  - Script text, metadata
  - Download button (direct link to video_url)
  - Status indicator (queued → generating → ready → posted)
- [ ] Video generation progress:
  - Poll `GET /api/videos/:id` via TanStack Query (refetchInterval while status is queued/generating)
  - Show progress stages (script → voice → images → assembling)
- [ ] User settings page (profile, password, notifications)

### Phase 4 — AI Video Generation Pipeline (Week 5-8)

- [ ] Script generation service (OpenAI / Claude API)
  - Niche-specific prompt templates
  - Hook + body + CTA structure
  - Title and description generation
- [ ] Text-to-Speech service (ElevenLabs / OpenAI TTS)
  - Voice selection (6+ voices)
  - Speed/pitch controls
  - Timestamped word-level alignment output
- [ ] Image generation service (Flux / DALL-E / Stability AI)
  - Scene-to-prompt conversion
  - Art style application (Pixar, anime, realistic, etc.)
  - Batch generation with retry logic
- [ ] Video assembly service (FFmpeg)
  - Image-to-clip with Ken Burns effect
  - Audio track mixing (voiceover + background music)
  - Animated caption overlay (word-by-word highlight)
  - Transitions between scenes
  - Output in 9:16 format (1080x1920)
- [ ] Job queue setup (BullMQ)
  - Video generation jobs with progress tracking
  - Retry and dead-letter queue handling
  - Webhook notifications on completion
- [ ] Media storage (S3 / Cloudflare R2)
  - Upload generated assets (audio, images, video)
  - CDN delivery for preview playback
  - Automatic cleanup of temporary files

### Phase 5 — Social Media Integration (Week 8-10)

- [ ] TikTok OAuth integration
  - Content Posting API (direct post + draft)
  - Caption and hashtag support
- [ ] Instagram OAuth integration
  - Instagram Graph API for Reels
  - Container-based media upload flow
- [ ] YouTube OAuth integration
  - YouTube Data API v3 for Shorts
  - Metadata (title, description, tags)
- [ ] Auto-posting scheduler
  - Cron-based posting at optimal times
  - Rate limiting and retry logic
  - Posting status tracking per video

### Phase 6 — Billing & Monetization (Week 10-11)

- [ ] Stripe integration
  - Subscription plans (Starter, Pro, Agency)
  - Usage-based metering (videos/month)
  - Customer portal for self-service management
- [ ] Plan gating
  - Feature flags per plan tier
  - Video count limits enforcement
  - Platform connection limits
  - Owner/admin role bypass for all limits
- [ ] Pricing page on marketing site

### Phase 7 — Analytics & Polish (Week 11-13)

- [ ] Video performance analytics
  - Views, likes, comments aggregation
  - Per-channel and per-series breakdowns
- [ ] Dashboard analytics widgets
  - Total views, subscriber growth, top videos
- [ ] Email notifications (Resend / SendGrid)
  - Video ready notifications
  - Weekly performance digest
- [ ] Blog system (MDX-based or CMS)
- [ ] Error monitoring (Sentry)
- [ ] Performance optimization (caching, lazy loading)
- [ ] Comprehensive testing (unit + integration + e2e)

### Phase 8 — Launch Prep (Week 13-14)

- [ ] Production deployment checklist
- [ ] Load testing video pipeline
- [ ] Security audit (auth, API keys, CORS, rate limiting)
- [ ] Legal pages (Terms of Service, Privacy Policy)
- [ ] Domain and DNS setup
- [ ] Monitoring and alerting (uptime, error rates)
- [ ] Soft launch with beta users

---

## 5. Database Schema Overview

```
User
├── id, email, name, password_hash, avatar_url
├── role (owner | admin | user)           ← DEFAULT: "user"
├── plan (free | starter | pro | agency)  ← source of truth for limit checks
├── stripe_customer_id
├── created_at, updated_at
│
├── Series (1:many)
│   ├── id, user_id, name, niche, art_style
│   ├── music_type, music_url, voice_id
│   ├── target_platforms (json array: ["tiktok", "instagram", "youtube"])
│   ├── posting_schedule (json: { frequency, time, timezone })
│   ├── status (active | paused)
│   ├── created_at, updated_at
│   │
│   └── Video (1:many)
│       ├── id, series_id, title, description
│       ├── script_text, voiceover_url
│       ├── video_url, thumbnail_url, duration
│       ├── status (queued | generating | ready | scheduled | posted | failed)
│       ├── generation_stage (nullable: script | tts | images | assembly | uploading)
│       ├── scheduled_post_time (nullable datetime)
│       ├── posted_platforms (json: [{ platform, post_id, posted_at }])
│       ├── error_message (nullable, set on failure)
│       ├── created_at, updated_at
│
├── SocialAccount (1:many)
│   ├── id, user_id, platform (tiktok | instagram | youtube)
│   ├── platform_user_id, access_token_enc, refresh_token_enc
│   ├── username, profile_url
│   └── connected_at, token_expires_at
│
└── Subscription (1:1)
    ├── id, user_id, stripe_subscription_id
    ├── stripe_price_id, status (active | past_due | canceled)
    ├── current_period_start, current_period_end
    └── created_at, updated_at
```

**Plan limits:**

| Plan | Price | Videos/mo | Series | Platforms | Art Styles | Voices |
|------|-------|-----------|--------|-----------|------------|--------|
| free | $0 | 3 | 1 | 0 | 2 (basic) | 2 (standard) |
| starter | $19/mo | 30 | 5 | 1 | All | Standard |
| pro | $49/mo | 100 | 20 | 3 | All | All (premium) |
| agency | $99/mo | 300 | Unlimited | Unlimited | All | All (premium) |

New users start on the `free` plan (3 videos/month, no social posting). This lets them test the product before paying.

**Schema notes:**
- `User.plan` is the source of truth for limit checks. Updated by Stripe webhook when subscription changes.
- `SocialAccount` tokens are stored encrypted (`_enc` suffix). Decrypted only at posting time.
- `Video.scheduled_post_time` is set when a video is ready and the series has auto-posting enabled.
- `Video.posted_platforms` is a JSON array tracking which platforms the video was posted to, with post IDs for analytics.

---

## 5.1 Roles & Permissions

| Role | Plan Limits | Video Gen | Social Posting | Admin Panel | Manage Users |
|------|-------------|-----------|----------------|-------------|--------------|
| **owner** | Bypassed | Unlimited | Unlimited | Full access | Yes |
| **admin** | Bypassed | Unlimited | Unlimited | Full access | Yes (cannot modify owner) |
| **user** | Enforced per plan | Per plan quota | Per plan quota | No access | No |

### Owner Account Setup

The owner registers through the normal sign-up flow (email + password, hashed via bcrypt). The seed script (`prisma/seed.ts`) reads `OWNER_EMAIL` from environment variables and promotes that account to `role: owner`. No plaintext passwords are stored in env files.

- Owner cannot be deleted or demoted via API
- Owner can promote/demote other users to admin
- All plan limits and rate limits are bypassed for owner and admin roles

---

## 6. API Endpoints Overview

### Auth (NextAuth.js v5 — handles routes automatically)
- `POST /api/auth/signin` — Login (NextAuth built-in)
- `POST /api/auth/signout` — Logout (NextAuth built-in)
- `GET  /api/auth/session` — Current session (NextAuth built-in)
- `POST /api/auth/register` — Create account (custom: hash password, create user, then sign in)

### Series
- `GET    /api/series` — List user's series
- `POST   /api/series` — Create series
- `GET    /api/series/:id` — Get series details
- `PUT    /api/series/:id` — Update series
- `DELETE /api/series/:id` — Delete series

### Videos
- `GET    /api/series/:id/videos` — List videos in series
- `POST   /api/series/:id/videos/generate` — Trigger video generation (creates job, returns video ID)
- `GET    /api/videos/:id` — Get video details (includes status + generation_stage for polling)
- `GET    /api/videos/:id/download` — Redirect to signed R2/S3 download URL
- `POST   /api/videos/:id/publish` — Publish to connected platforms
- `DELETE /api/videos/:id` — Delete video + remove media from storage

### Social Accounts
- `GET    /api/social-accounts` — List connected accounts
- `POST   /api/social-accounts/connect/:platform` — Init OAuth
- `GET    /api/social-accounts/callback/:platform` — OAuth callback
- `DELETE /api/social-accounts/:id` — Disconnect account

### Billing
- `GET  /api/billing/plans` — List available plans
- `POST /api/billing/checkout` — Create Stripe checkout session
- `POST /api/billing/webhook` — Stripe webhook handler
- `GET  /api/billing/portal` — Stripe customer portal URL

### Analytics
- `GET /api/analytics/overview` — Dashboard overview stats
- `GET /api/analytics/series/:id` — Series-level analytics
- `GET /api/analytics/videos/:id` — Video-level analytics

### Admin (owner/admin only)
- `GET    /api/admin/users` — List all users (paginated, searchable)
- `GET    /api/admin/users/:id` — Get user details
- `PATCH  /api/admin/users/:id` — Update user (role, plan, status)
- `DELETE /api/admin/users/:id` — Delete user and their data
- `GET    /api/admin/videos` — List all videos across users
- `DELETE /api/admin/videos/:id` — Remove video (moderation)
- `GET    /api/admin/analytics` — System-wide stats (total users, videos, revenue)
- `GET    /api/admin/queue` — BullMQ job queue health and status

---

## 7. Third-Party Services Required

| Service | Purpose | Est. Cost |
|---------|---------|-----------|
| OpenAI / Anthropic | Script generation (GPT-4o / Claude) | ~$0.01-0.05/script |
| ElevenLabs / OpenAI TTS | Text-to-Speech voiceover | ~$0.01-0.10/video |
| Flux / DALL-E / Stability AI | Image generation per scene | ~$0.02-0.10/image |
| FFmpeg | Video assembly (self-hosted) | Free |
| Cloudflare R2 / AWS S3 | Media storage | ~$0.015/GB/month |
| Stripe | Payment processing | 2.9% + $0.30/txn |
| Vercel | Frontend hosting | Free-$20/month |
| Railway / Fly.io / AWS | Backend workers + DB hosting | ~$20-100/month |
| Redis (Upstash) | Caching + job queue | Free-$10/month |
| Resend / SendGrid | Transactional emails | Free-$20/month |
| Sentry | Error monitoring | Free tier |
| Plausible / PostHog | Analytics | Free-$9/month |
| TikTok API | Content posting | Free (rate limited) |
| Instagram Graph API | Reels posting | Free (rate limited) |
| YouTube Data API v3 | Shorts upload | Free (quota limited) |

---

## 8. Environment Variables Required

See [.env.example](./.env.example) for the full list with comments and links to each service's dashboard. The env file is the single source of truth for variable names.

---

## 9. Folder Structure

```
narrateai/
├── .env.example
├── .env.local
├── .eslintrc.js
├── .prettierrc
├── docker-compose.yml              # Local Postgres + Redis
├── next.config.js
├── tailwind.config.ts
├── tsconfig.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── public/
│   ├── images/
│   ├── fonts/
│   └── favicon.ico
├── src/
│   ├── app/                          # Next.js App Router
│   │   ├── (marketing)/              # Public pages group
│   │   │   ├── page.tsx              # Landing page
│   │   │   ├── blog/
│   │   │   ├── pricing/
│   │   │   └── layout.tsx
│   │   ├── (auth)/                   # Auth pages group
│   │   │   ├── login/
│   │   │   ├── register/
│   │   │   └── layout.tsx
│   │   ├── (dashboard)/              # Protected dashboard group
│   │   │   ├── dashboard/
│   │   │   ├── series/
│   │   │   │   ├── page.tsx          # Series list
│   │   │   │   ├── new/              # Create series wizard
│   │   │   │   └── [id]/            # Series detail
│   │   │   ├── videos/
│   │   │   │   └── [id]/            # Video detail + preview
│   │   │   ├── accounts/             # Social account management
│   │   │   ├── analytics/
│   │   │   ├── settings/
│   │   │   ├── billing/
│   │   │   └── layout.tsx
│   │   ├── (admin)/                  # Admin-only pages (owner/admin role)
│   │   │   ├── admin/
│   │   │   │   ├── page.tsx          # Admin dashboard overview
│   │   │   │   ├── users/            # User management
│   │   │   │   ├── videos/           # Video moderation
│   │   │   │   ├── analytics/        # System-wide analytics
│   │   │   │   └── queue/            # Job queue monitoring
│   │   │   └── layout.tsx            # Admin layout + role guard
│   │   ├── api/                      # API routes
│   │   │   ├── auth/
│   │   │   ├── series/
│   │   │   ├── videos/
│   │   │   ├── social-accounts/
│   │   │   ├── billing/
│   │   │   ├── analytics/
│   │   │   └── admin/                # Admin-only API endpoints
│   │   ├── layout.tsx                # Root layout
│   │   └── globals.css
│   ├── components/
│   │   ├── ui/                       # shadcn/ui primitives
│   │   ├── landing/                  # Landing page sections
│   │   ├── dashboard/                # Dashboard components
│   │   ├── series/                   # Series-related components
│   │   ├── video/                    # Video player, preview
│   │   └── shared/                   # Shared components
│   ├── lib/
│   │   ├── db.ts                     # Prisma client
│   │   ├── redis.ts                  # Redis client
│   │   ├── auth.ts                   # Auth utilities + role checks
│   │   ├── permissions.ts            # isPrivilegedRole() and plan limit helpers
│   │   ├── stripe.ts                 # Stripe utilities
│   │   ├── storage.ts                # S3/R2 upload utilities
│   │   └── utils.ts                  # General utilities
│   ├── services/
│   │   ├── script-generator.ts       # LLM script generation
│   │   ├── tts.ts                    # Text-to-Speech service
│   │   ├── image-generator.ts        # AI image generation
│   │   ├── video-assembler.ts        # FFmpeg video assembly
│   │   ├── social-poster.ts          # Social media posting
│   │   └── queue.ts                  # BullMQ job definitions
│   ├── hooks/                        # React custom hooks
│   ├── types/                        # TypeScript type definitions
│   └── config/                       # App configuration constants
├── workers/
│   ├── video-generation.ts           # Video generation worker
│   └── social-posting.ts             # Social posting worker
├── scripts/
│   ├── seed.ts                       # DB seed script (creates owner account)
│   └── migrate.ts                    # Migration helper
└── tests/
    ├── unit/
    ├── integration/
    └── e2e/
```

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Video generation time | < 5 minutes per video |
| Landing page Lighthouse score | > 90 (performance) |
| API response time (p95) | < 500ms |
| Video pipeline success rate | > 95% |
| Auto-post success rate | > 98% |
| Time to first video (new user) | < 10 minutes |

---

## 11. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| AI API costs spiral | High | Implement usage caps per plan, cache common scripts |
| Social platform API changes | High | Abstract posting behind interface, monitor changelogs |
| FFmpeg processing bottleneck | Medium | Horizontal worker scaling, queue prioritization |
| Image generation rate limits | Medium | Multi-provider fallback (Flux → DALL-E → Stability) |
| OAuth token expiration | Medium | Background token refresh cron job |
| Video quality inconsistency | Medium | Quality scoring + regeneration option |
| Stripe webhook failures | Low | Idempotent handlers, webhook retry queue |
