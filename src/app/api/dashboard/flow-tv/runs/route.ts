import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod/v4";
import { createRun, listRuns, deleteRun } from "@/services/flow-tv-run";
import { enqueueFlowTvAdvance } from "@/services/queue";

const createSchema = z.object({
  imageCount: z.number().int().min(2).max(12).default(3),
  veoVariant: z.enum(["Lite", "Fast", "Quality"]).default("Lite"),
  approvalMode: z
    .enum(["auto", "storyline", "storyline+images", "storyline+images+clips"])
    .default("storyline+images+clips"),
  storyTitleHint: z.string().optional(),
  niche: z
    .enum(["zero-to-hero", "funny", "moral", "horror", "mythological"])
    .default("funny"),
  language: z.enum(["hindi", "english"]).default("hindi"),
  characterStyle: z
    .enum(["cartoon_3d", "hyperreal_3d", "photoreal"])
    .default("hyperreal_3d"),
  aspectRatio: z.enum(["9:16", "16:9"]).default("9:16"),
  dialogue: z.boolean().default(true),
  bgm: z.boolean().default(true),
  sfx: z.boolean().default(true),
  subtitles: z.boolean().default(false),
  useRecurringCharacter: z.boolean().default(false),
  reuseCharacterId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .optional()
    .or(z.literal("").transform(() => undefined)),
  storylineSource: z.enum(["api", "web"]).default("web"),
  triggerSource: z.string().default("ui"),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const run = await createRun({
    userId: session.user.id,
    imageCount: parsed.data.imageCount,
    veoVariant: parsed.data.veoVariant,
    approvalMode: parsed.data.approvalMode,
    storyTitleHint: parsed.data.storyTitleHint,
    niche: parsed.data.niche,
    triggerSource: parsed.data.triggerSource,
    language: parsed.data.language,
    characterStyle: parsed.data.characterStyle,
    aspectRatio: parsed.data.aspectRatio,
    dialogue: parsed.data.dialogue,
    bgm: parsed.data.bgm,
    sfx: parsed.data.sfx,
    subtitles: parsed.data.subtitles,
    useRecurringCharacter: parsed.data.useRecurringCharacter,
    reuseCharacterId: parsed.data.reuseCharacterId,
    storylineSource: parsed.data.storylineSource,
  });

  await enqueueFlowTvAdvance(run.id);

  return NextResponse.json({ data: run }, { status: 201 });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runs = await listRuns({ userId: session.user.id, limit: 50 });
  return NextResponse.json({ data: runs });
}

/**
 * Bulk-delete every Flow TV run owned by the caller. Skips runs in busy
 * stages (currently rendering / stitching) — those need to settle first.
 * Body: empty (or `{}`).
 *
 * Returns counts of deleted vs skipped so the UI can show e.g.
 *   "Deleted 4 runs (2 still busy)".
 */
export async function DELETE() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const runs = await listRuns({ userId: session.user.id });
  const busyStages = new Set([
    "generating_storyline",
    "generating_images",
    "generating_clips",
    "stitching",
    "finalizing",
  ]);
  let deleted = 0;
  let skipped = 0;
  const skippedIds: string[] = [];
  for (const r of runs) {
    const stillFresh = Date.now() - r.stageUpdatedAt < 2 * 60_000;
    if (busyStages.has(r.stage) && stillFresh) {
      skipped += 1;
      skippedIds.push(r.id);
      continue;
    }
    const ok = await deleteRun(r.id);
    if (ok) deleted += 1;
  }
  return NextResponse.json({ data: { deleted, skipped, skippedIds } });
}
