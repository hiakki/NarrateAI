import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDataCookiePath } from "@/lib/cookie-path";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";

interface CookieMeta {
  fbSavedAt?: string | null;
  igSavedAt?: string | null;
}

const META_PATH = path.join(process.cwd(), "data", "cookie-meta.json");

async function readMeta(): Promise<CookieMeta> {
  try {
    return JSON.parse(await fs.readFile(META_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function writeMeta(meta: CookieMeta): Promise<void> {
  await fs.mkdir(path.dirname(META_PATH), { recursive: true });
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

function isFbDomain(d: string): boolean {
  return d.includes("facebook.com") || d.includes(".fb.com");
}

function isIgDomain(d: string): boolean {
  return d.includes("instagram.com");
}

function extractPlatformCookies(content: string): { fbLines: string[]; igLines: string[] } {
  const dataLines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
  const fbLines: string[] = [];
  const igLines: string[] = [];
  for (const line of dataLines) {
    const domain = (line.split("\t")[0] ?? "").toLowerCase();
    if (isFbDomain(domain)) fbLines.push(line);
    if (isIgDomain(domain)) igLines.push(line);
  }
  return { fbLines, igLines };
}

function fingerprint(lines: string[]): string {
  return crypto.createHash("md5").update(lines.sort().join("\n")).digest("hex");
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookiePath = getDataCookiePath();
    let exists = false;
    let lineCount = 0;
    let fbConnected = false;
    let igConnected = false;
    let fbCookieCount = 0;
    let igCookieCount = 0;
    let fbEarliestExpiry: string | null = null;
    let igEarliestExpiry: string | null = null;
    try {
      const content = await fs.readFile(cookiePath, "utf-8");
      exists = true;
      const dataLines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      lineCount = dataLines.length;

      const nowSec = Math.floor(Date.now() / 1000);
      let fbMinExp = Infinity;
      let igMinExp = Infinity;

      for (const line of dataLines) {
        const parts = line.split("\t");
        const domain = (parts[0] ?? "").toLowerCase();
        const expiry = Number(parts[4] ?? "0");

        if (isFbDomain(domain)) {
          fbCookieCount++;
          if (expiry > nowSec && expiry < fbMinExp) fbMinExp = expiry;
        }
        if (isIgDomain(domain)) {
          igCookieCount++;
          if (expiry > nowSec && expiry < igMinExp) igMinExp = expiry;
        }
      }
      fbConnected = fbCookieCount >= 3;
      igConnected = igCookieCount >= 3;
      if (fbMinExp < Infinity) fbEarliestExpiry = new Date(fbMinExp * 1000).toISOString();
      if (igMinExp < Infinity) igEarliestExpiry = new Date(igMinExp * 1000).toISOString();
    } catch {
      exists = false;
    }

    let meta = await readMeta();
    // Bootstrap: if meta file doesn't exist yet but cookies do, use file mtime
    if (exists && !meta.fbSavedAt && !meta.igSavedAt) {
      try {
        const stat = await fs.stat(cookiePath);
        const mtime = stat.mtime.toISOString();
        if (fbConnected) meta.fbSavedAt = mtime;
        if (igConnected) meta.igSavedAt = mtime;
        if (meta.fbSavedAt || meta.igSavedAt) await writeMeta(meta);
      } catch { /* stat failed, skip bootstrap */ }
    }

    const envConfigured = !!process.env.YTDLP_COOKIES_FILE;

    return NextResponse.json({
      data: {
        exists, lineCount, envConfigured,
        fbConnected, igConnected, fbCookieCount, igCookieCount,
        fbSavedAt: meta.fbSavedAt ?? null,
        igSavedAt: meta.igSavedAt ?? null,
        fbEarliestExpiry, igEarliestExpiry,
      },
    });
  } catch (error) {
    console.error("Get cookies status error:", error);
    return NextResponse.json({ error: "Failed to check cookies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { cookieText } = body as { cookieText?: string };

    if (!cookieText || typeof cookieText !== "string" || cookieText.trim().length < 10) {
      return NextResponse.json({ error: "Invalid cookie content" }, { status: 400 });
    }

    const lines = cookieText.trim().split("\n");
    const dataLines = lines.filter((l) => l.trim() && !l.startsWith("#"));
    if (dataLines.length === 0) {
      return NextResponse.json({ error: "No valid cookie entries found. Ensure Netscape cookie format." }, { status: 400 });
    }

    const hasTabSeparated = dataLines.some((l) => l.split("\t").length >= 6);
    if (!hasTabSeparated) {
      return NextResponse.json(
        { error: "Cookies must be in Netscape/Mozilla format (tab-separated). Use a browser extension like 'Get cookies.txt LOCALLY'." },
        { status: 400 },
      );
    }

    const cookiePath = getDataCookiePath();
    await fs.mkdir(path.dirname(cookiePath), { recursive: true });

    // Detect which platforms' cookies actually changed
    let oldFbFp = "";
    let oldIgFp = "";
    try {
      const oldContent = await fs.readFile(cookiePath, "utf-8");
      const old = extractPlatformCookies(oldContent);
      oldFbFp = fingerprint(old.fbLines);
      oldIgFp = fingerprint(old.igLines);
    } catch { /* no old file */ }

    await fs.writeFile(cookiePath, cookieText.trim() + "\n", "utf-8");

    const newExtracted = extractPlatformCookies(cookieText);
    const newFbFp = fingerprint(newExtracted.fbLines);
    const newIgFp = fingerprint(newExtracted.igLines);

    const meta = await readMeta();
    const now = new Date().toISOString();
    if (newFbFp !== oldFbFp && newExtracted.fbLines.length > 0) meta.fbSavedAt = now;
    if (newIgFp !== oldIgFp && newExtracted.igLines.length > 0) meta.igSavedAt = now;
    // First save ever: set timestamps for platforms that have cookies
    if (!meta.fbSavedAt && newExtracted.fbLines.length > 0) meta.fbSavedAt = now;
    if (!meta.igSavedAt && newExtracted.igLines.length > 0) meta.igSavedAt = now;
    await writeMeta(meta);

    return NextResponse.json({
      data: { saved: true, lineCount: dataLines.length },
    });
  } catch (error) {
    console.error("Save cookies error:", error);
    return NextResponse.json({ error: "Failed to save cookies" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookiePath = getDataCookiePath();
    try { await fs.unlink(cookiePath); } catch { /* already gone */ }
    try { await fs.unlink(META_PATH); } catch { /* already gone */ }

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error("Delete cookies error:", error);
    return NextResponse.json({ error: "Failed to delete cookies" }, { status: 500 });
  }
}
