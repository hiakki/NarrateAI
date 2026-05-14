// Flow TV — schedule update/delete by id.
//
// See ../route.ts for the per-user CRUD overview.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";

const FLOW_NICHES = [
  "zero-to-hero",
  "funny",
  "moral",
  "horror",
  "mythological",
] as const;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const FLOW_TV_CONFIG_SCHEMA = z
  .object({
    imageCount: z.number().int().min(2).max(12).optional(),
    veoVariant: z.enum(["Lite", "Fast"]).optional(),
    language: z.enum(["hindi", "english"]).optional(),
    characterStyle: z
      .enum(["cartoon_3d", "hyperreal_3d", "photoreal"])
      .optional(),
    aspectRatio: z.enum(["9:16", "16:9"]).optional(),
    dialogue: z.boolean().optional(),
    bgm: z.boolean().optional(),
    sfx: z.boolean().optional(),
    subtitles: z.boolean().optional(),
    useRecurringCharacter: z.boolean().optional(),
    storylineSource: z.enum(["api", "web"]).optional(),
    storyTitleHint: z.string().trim().max(200).optional(),
  })
  .partial();

const PATCH_SCHEMA = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    niche: z.enum(FLOW_NICHES).optional(),
    postTime: z.string().regex(HHMM).optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
    enabled: z.boolean().optional(),
    targetPlatforms: z
      .array(z.enum(["YOUTUBE", "FACEBOOK", "INSTAGRAM", "TIKTOK"]))
      .optional(),
    // Partial flowTvConfig patch — merged into the existing JSON.
    flowTvConfig: FLOW_TV_CONFIG_SCHEMA.optional(),
  })
  .strict();

async function loadOwnedAutomation(userId: string, id: string) {
  return db.automation.findFirst({
    where: { id, userId, automationType: "flow-tv" },
  });
}

// ──────────────────────────────────────────────────────────────────────────────
//  PATCH — update schedule fields + merge flowTvConfig
// ──────────────────────────────────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await loadOwnedAutomation(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = PATCH_SCHEMA.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  // Merge the partial flowTvConfig patch into the existing JSON. If the
  // top-level niche is changing, sync it into the config too so downstream
  // readers always see one consistent value.
  const existingCfg = (existing.flowTvConfig ?? {}) as Record<string, unknown>;
  const cfgPatch = parsed.data.flowTvConfig ?? {};
  const mergedCfg = { ...existingCfg, ...cfgPatch };
  if (parsed.data.niche) {
    (mergedCfg as Record<string, unknown>).niche = parsed.data.niche;
  }

  const updated = await db.automation.update({
    where: { id },
    data: {
      ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
      ...(parsed.data.niche !== undefined ? { niche: parsed.data.niche } : {}),
      ...(parsed.data.postTime !== undefined
        ? { postTime: parsed.data.postTime }
        : {}),
      ...(parsed.data.timezone !== undefined
        ? { timezone: parsed.data.timezone }
        : {}),
      ...(parsed.data.enabled !== undefined
        ? { enabled: parsed.data.enabled }
        : {}),
      ...(parsed.data.targetPlatforms !== undefined
        ? { targetPlatforms: parsed.data.targetPlatforms as never }
        : {}),
      ...(parsed.data.flowTvConfig !== undefined ||
      parsed.data.niche !== undefined
        ? { flowTvConfig: mergedCfg as never }
        : {}),
    },
  });

  return NextResponse.json({ data: updated });
}

// ──────────────────────────────────────────────────────────────────────────────
//  DELETE — remove schedule and its dedicated series (videos cascade off)
// ──────────────────────────────────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await ctx.params;
  const existing = await loadOwnedAutomation(session.user.id, id);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await db.$transaction(async (tx) => {
    const seriesId = existing.seriesId;
    await tx.automation.delete({ where: { id } });
    // Series.automation onDelete is SetNull, so the series row survives.
    // We drop it explicitly here since multi-slot schedules each own a
    // dedicated series with no other purpose.
    if (seriesId) {
      await tx.series.delete({ where: { id: seriesId } }).catch(() => {
        // Series may still have READY/SCHEDULED videos referenced by other
        // tables — swallow the error and leave the row in place. The UI's
        // /dashboard/videos page filters by user, so this is benign.
      });
    }
  });

  return NextResponse.json({ ok: true });
}
