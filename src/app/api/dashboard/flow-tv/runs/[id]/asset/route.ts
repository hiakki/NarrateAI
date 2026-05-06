// Stream a file that lives under the run's runDir. Used by the Flow TV UI to
// preview screenshots, scene images, and clip thumbnails BEFORE the run is
// finalized into public/videos/.
//
// Query params:
//   path=<relative path under runDir>
//
// Only paths that resolve INSIDE runDir are allowed (path traversal guard).

import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fsSync from "fs";
import { promises as fs } from "fs";
import { auth } from "@/lib/auth";
import { loadRun } from "@/services/flow-tv-run";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".json": "application/json",
  ".txt": "text/plain",
};

export async function GET(
  req: NextRequest,
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

  const rel = req.nextUrl.searchParams.get("path");
  if (!rel) return NextResponse.json({ error: "Missing path" }, { status: 400 });

  const runDirAbs = path.resolve(run.runDir);
  const resolved = path.resolve(runDirAbs, rel);
  if (!resolved.startsWith(runDirAbs + path.sep) && resolved !== runDirAbs) {
    return NextResponse.json({ error: "Path traversal denied" }, { status: 400 });
  }
  if (!fsSync.existsSync(resolved)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const stat = await fs.stat(resolved);
  if (!stat.isFile()) {
    return NextResponse.json({ error: "Not a file" }, { status: 400 });
  }

  const buf = await fs.readFile(resolved);
  const ext = path.extname(resolved).toLowerCase();
  const ct = MIME[ext] ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": ct,
      "Content-Length": String(stat.size),
      "Cache-Control": "no-store",
    },
  });
}
