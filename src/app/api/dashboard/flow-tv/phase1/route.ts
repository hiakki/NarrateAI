import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

let activeRun: { startedAt: number; promise: Promise<unknown> } | null = null;

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (activeRun && Date.now() - activeRun.startedAt < 15 * 60 * 1000) {
    return NextResponse.json({
      data: { status: "in_progress", message: "Phase 1 already running. Poll GET for status." },
    });
  }

  const body = await req.json().catch(() => ({}));
  const imageCountRaw = Number(body?.imageCount ?? 3);
  const imageCount = Number.isFinite(imageCountRaw) ? Math.max(1, Math.min(Math.floor(imageCountRaw), 5)) : 3;
  const reset = body?.reset === true;
  const resetProject = body?.resetProject === true;

  const { runPhase1, resetPhase1Cache } = await import("@/services/flow-tv-phase1");
  const { dateSuffixedSlug, flowProjectNameFromStorySlug } = await import(
    "@/services/flow-tv-naming"
  );

  // Derive a per-call storySlug. Real Flow TV runs go through the
  // /api/dashboard/flow-tv/run endpoints (run-machine) which carry storySlug
  // explicitly; this legacy endpoint is kept for ad-hoc Phase-1 dry runs.
  const storyTitle = (body?.storyTitle as string) || "Phase 1 Dry Run";
  const storySlug = dateSuffixedSlug(storyTitle);
  const projectName = flowProjectNameFromStorySlug(storySlug);

  if (reset || resetProject) {
    await resetPhase1Cache({ storySlug, storyline: !!reset, project: !!resetProject });
  }

  const startedAt = Date.now();
  const promise = runPhase1({ imageCount, storySlug, projectName })
    .catch(() => null)
    .finally(() => {
      activeRun = null;
    });
  activeRun = { startedAt, promise };

  return NextResponse.json({
    data: {
      status: "started",
      message: `Phase 1 started for ${imageCount} image(s). A visible Chrome window will open.`,
      imageCount,
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { getPhase1Progress } = await import("@/services/flow-tv-phase1");
  const progress = getPhase1Progress();
  if (!progress) {
    return NextResponse.json({ data: { status: "idle", message: "No Phase 1 run yet." } });
  }
  return NextResponse.json({ data: progress });
}
