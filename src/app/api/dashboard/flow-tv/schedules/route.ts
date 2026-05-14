// Flow TV — per-day schedules CRUD.
//
// A "schedule" is an `Automation` row with `automationType = "flow-tv"` plus
// a `flowTvConfig` JSON snapshot of the user's preferred run settings. The
// scheduler worker (`workers/scheduler.ts`) iterates enabled Automation rows
// every BUILD_ALL_TIME tick and, when it picks up a flow-tv row, dispatches
// `createRun({ automationId, niche, ...flowTvConfig })` so the resulting
// Video is correctly attributed to THIS schedule's series.
//
// Endpoints:
//   GET    /api/dashboard/flow-tv/schedules           list current user's schedules
//   POST   /api/dashboard/flow-tv/schedules           create a new schedule
//   PATCH  /api/dashboard/flow-tv/schedules/[id]      update name/niche/postTime/timezone/enabled/flowTvConfig
//   DELETE /api/dashboard/flow-tv/schedules/[id]      delete schedule + its dedicated series
//
// We deliberately store the niche on both:
//   - `automation.niche`  (canonical so the rest of the scheduler can read it)
//   - `flowTvConfig.niche` (also stored for back-compat; scheduler prefers
//                            config when both are present)
// so existing code paths that select `automation.niche` keep working.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";

// ──────────────────────────────────────────────────────────────────────────────
//  Shared shape (kept aligned with workers/scheduler.ts FlowNiche coerceEnum)
// ──────────────────────────────────────────────────────────────────────────────

const FLOW_NICHES = [
  "zero-to-hero",
  "funny",
  "moral",
  "horror",
  "mythological",
] as const;

const FLOW_TV_CONFIG_SCHEMA = z.object({
  imageCount: z.number().int().min(2).max(12).default(8),
  veoVariant: z.enum(["Lite", "Fast"]).default("Lite"),
  language: z.enum(["hindi", "english"]).default("hindi"),
  characterStyle: z
    .enum(["cartoon_3d", "hyperreal_3d", "photoreal"])
    .default("cartoon_3d"),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  dialogue: z.boolean().default(true),
  bgm: z.boolean().default(true),
  sfx: z.boolean().default(true),
  subtitles: z.boolean().default(false),
  useRecurringCharacter: z.boolean().default(false),
  storylineSource: z.enum(["api", "web"]).default("web"),
  storyTitleHint: z.string().trim().max(200).optional(),
});

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const CREATE_SCHEMA = z.object({
  name: z.string().trim().min(1).max(80),
  niche: z.enum(FLOW_NICHES),
  postTime: z.string().regex(HHMM, "postTime must be HH:MM (24h)"),
  timezone: z.string().trim().min(1).max(80),
  enabled: z.boolean().default(true),
  // targetPlatforms is optional — schedule rows default to the same trio as
  // the auto-created legacy row so the resulting Video posts to all three.
  targetPlatforms: z
    .array(z.enum(["YOUTUBE", "FACEBOOK", "INSTAGRAM", "TIKTOK"]))
    .default(["YOUTUBE", "FACEBOOK", "INSTAGRAM"]),
  flowTvConfig: FLOW_TV_CONFIG_SCHEMA,
});

// ──────────────────────────────────────────────────────────────────────────────
//  GET — list this user's flow-tv schedules
// ──────────────────────────────────────────────────────────────────────────────

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const automations = await db.automation.findMany({
    where: { userId: session.user.id, automationType: "flow-tv" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      name: true,
      niche: true,
      enabled: true,
      frequency: true,
      postTime: true,
      timezone: true,
      targetPlatforms: true,
      lastRunAt: true,
      flowTvConfig: true,
      seriesId: true,
      createdAt: true,
      updatedAt: true,
      series: {
        select: {
          _count: { select: { videos: true } },
          videos: {
            orderBy: { createdAt: "desc" },
            take: 1,
            select: {
              id: true,
              title: true,
              status: true,
              videoUrl: true,
              scheduledPostTime: true,
              createdAt: true,
            },
          },
        },
      },
    },
  });

  const data = automations.map((a) => ({
    ...a,
    lastVideo: a.series?.videos[0] ?? null,
    videoCount: a.series?._count.videos ?? 0,
    series: undefined,
  }));

  return NextResponse.json({ data });
}

// ──────────────────────────────────────────────────────────────────────────────
//  POST — create a new schedule (with its own dedicated Series)
// ──────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = CREATE_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const userId = session.user.id;
  const input = parsed.data;
  // Persist the niche in BOTH locations so existing code that reads from
  // either keeps working. flowTvConfig.niche becomes authoritative; the
  // top-level Automation.niche stays in sync for legacy callers.
  const flowTvConfig = { ...input.flowTvConfig, niche: input.niche };

  const result = await db.$transaction(async (tx) => {
    const series = await tx.series.create({
      data: {
        userId,
        name: `[Flow TV] ${input.name}`,
        niche: input.niche,
        artStyle: "realistic",
        language: "en",
        tone: "dramatic",
      },
    });
    const automation = await tx.automation.create({
      data: {
        userId,
        name: input.name,
        niche: input.niche,
        artStyle: "realistic",
        language: "en",
        tone: "dramatic",
        duration: 16,
        automationType: "flow-tv",
        imageToVideoProvider: "FLOW_TV",
        targetPlatforms: input.targetPlatforms as never,
        enabled: input.enabled,
        frequency: "daily",
        postTime: input.postTime,
        timezone: input.timezone,
        seriesId: series.id,
        flowTvConfig: flowTvConfig as never,
      },
    });
    return { series, automation };
  });

  return NextResponse.json({ data: result.automation }, { status: 201 });
}
