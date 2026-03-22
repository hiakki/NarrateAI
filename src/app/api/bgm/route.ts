import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "fs";
import path from "path";

const BGM_DIR = path.join(process.cwd(), "assets", "music");
const ALLOWED_EXT = new Set([".mp3", ".aac", ".m4a", ".ogg", ".wav"]);

const MIME_MAP: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".aac": "audio/aac",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
};

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const track = req.nextUrl.searchParams.get("track");

  // No track param → list all available BGM tracks
  if (!track) {
    try {
      const files = fs.readdirSync(BGM_DIR)
        .filter((f) => ALLOWED_EXT.has(path.extname(f).toLowerCase()))
        .sort();
      return NextResponse.json({ data: files });
    } catch {
      return NextResponse.json({ data: [] });
    }
  }

  const sanitized = path.basename(track);
  const ext = path.extname(sanitized).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) return NextResponse.json({ error: "Invalid file type" }, { status: 400 });

  const filePath = path.join(BGM_DIR, sanitized);
  if (!filePath.startsWith(BGM_DIR) || !fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Track not found" }, { status: 404 });
  }

  const stat = fs.statSync(filePath);
  const stream = fs.readFileSync(filePath);

  return new NextResponse(stream, {
    headers: {
      "Content-Type": MIME_MAP[ext] ?? "application/octet-stream",
      "Content-Length": stat.size.toString(),
      "Cache-Control": "public, max-age=86400",
    },
  });
}
