import { NextRequest, NextResponse } from "next/server";
import path from "path";
import { auth } from "@/lib/auth";
import { loadRun, deleteRun } from "@/services/flow-tv-run";

// Build an asset URL under the runDir for a given absolute file path. Returns
// undefined if the path is missing or outside runDir.
function toAssetUrl(runId: string, runDir: string, abs?: string): string | undefined {
  if (!abs) return undefined;
  const runDirAbs = path.resolve(runDir);
  const absResolved = path.resolve(abs);
  if (!absResolved.startsWith(runDirAbs + path.sep) && absResolved !== runDirAbs) {
    return undefined;
  }
  const rel = path.relative(runDirAbs, absResolved);
  return `/api/dashboard/flow-tv/runs/${runId}/asset?path=${encodeURIComponent(rel)}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const urls = {
    characterUrl: toAssetUrl(id, run.runDir, run.characterPath),
    imageUrls: (run.imagePaths ?? []).map((p) => toAssetUrl(id, run.runDir, p)),
    clipUrls: (run.clipPaths ?? []).map((p) => toAssetUrl(id, run.runDir, p)),
    finalVideoUrl: toAssetUrl(id, run.runDir, run.finalVideoPath),
  };
  return NextResponse.json({ data: { ...run, urls } });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  // Block deletes for runs currently mid-execution — stitching / phase2
  // generation hold an exclusive browser session and the worker would race
  // against fs.rm of the run dir. The user can wait for the run to settle
  // (it'll error or complete within minutes), then delete.
  const busyStages = new Set([
    "generating_storyline",
    "generating_images",
    "generating_clips",
    "stitching",
    "finalizing",
  ]);
  const stillFresh = Date.now() - run.stageUpdatedAt < 2 * 60_000;
  if (busyStages.has(run.stage) && stillFresh) {
    return NextResponse.json(
      {
        error: `Run is currently in stage "${run.stage}". Wait for it to finish or error out, then retry the delete.`,
      },
      { status: 409 },
    );
  }
  const existed = await deleteRun(id);
  if (!existed) {
    return NextResponse.json({ error: "Already deleted" }, { status: 404 });
  }
  return NextResponse.json({ data: { id, deleted: true } });
}
