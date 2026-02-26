import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

const PLATFORM_URL_PATTERNS: Record<string, RegExp[]> = {
  YOUTUBE: [
    /^https?:\/\/(www\.)?(youtube\.com\/(shorts\/|watch\?v=)|youtu\.be\/)/i,
  ],
  INSTAGRAM: [
    /^https?:\/\/(www\.)?instagram\.com\/(reel|p)\//i,
  ],
  FACEBOOK: [
    /^https?:\/\/(www\.|m\.)?(facebook\.com|fb\.watch)\/(reel|share\/r|watch|.*\/videos)\//i,
  ],
};

interface PlatformEntry {
  platform: string;
  success?: boolean | "uploading";
  postId?: string | null;
  url?: string | null;
  error?: string;
  startedAt?: number;
  manualUrl?: boolean;
}

function validatePlatformUrl(platform: string, url: string): { valid: boolean; reason?: string } {
  try {
    new URL(url);
  } catch {
    return { valid: false, reason: "Invalid URL format" };
  }

  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    return { valid: false, reason: "URL must start with http:// or https://" };
  }

  const patterns = PLATFORM_URL_PATTERNS[platform];
  if (patterns && !patterns.some((p) => p.test(url))) {
    const examples: Record<string, string> = {
      YOUTUBE: "youtube.com/shorts/... or youtu.be/...",
      INSTAGRAM: "instagram.com/reel/... or instagram.com/p/...",
      FACEBOOK: "facebook.com/reel/... or fb.watch/...",
    };
    return {
      valid: false,
      reason: `URL doesn't look like a ${platform.toLowerCase()} link. Expected: ${examples[platform] ?? "a valid platform URL"}`,
    };
  }

  return { valid: true };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const body = await req.json();
    const { platform, url } = body as { platform?: string; url?: string };

    if (!platform || !url) {
      return NextResponse.json(
        { error: "Both 'platform' and 'url' are required" },
        { status: 400 },
      );
    }

    const validPlatforms = ["YOUTUBE", "INSTAGRAM", "FACEBOOK"];
    if (!validPlatforms.includes(platform)) {
      return NextResponse.json(
        { error: `Invalid platform. Must be one of: ${validPlatforms.join(", ")}` },
        { status: 400 },
      );
    }

    const validation = validatePlatformUrl(platform, url.trim());
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason, field: "url" },
        { status: 422 },
      );
    }

    const video = await db.video.findUnique({
      where: { id },
      include: { series: { select: { userId: true } } },
    });

    if (!video)
      return NextResponse.json({ error: "Video not found" }, { status: 404 });
    if (video.series.userId !== session.user.id && session.user.role === "USER")
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const currentPosted = (video.postedPlatforms ?? []) as PlatformEntry[];
    const trimmedUrl = url.trim();

    const existingIdx = currentPosted.findIndex(
      (e) => (typeof e === "string" ? e : e.platform) === platform,
    );

    let newPosted: PlatformEntry[];
    if (existingIdx >= 0) {
      newPosted = [...currentPosted];
      const existing = newPosted[existingIdx];
      if (typeof existing === "string") {
        newPosted[existingIdx] = { platform, success: true, url: trimmedUrl, manualUrl: true };
      } else {
        newPosted[existingIdx] = { ...existing, url: trimmedUrl, success: true, manualUrl: true };
      }
    } else {
      newPosted = [
        ...currentPosted,
        { platform, success: true, url: trimmedUrl, manualUrl: true },
      ];
    }

    await db.video.update({
      where: { id },
      data: {
        postedPlatforms: newPosted,
        status: "POSTED",
      },
    });

    return NextResponse.json({
      success: true,
      platform,
      url: trimmedUrl,
      postedPlatforms: newPosted,
    });
  } catch (error) {
    console.error("Update link error:", error);
    return NextResponse.json(
      { error: "Failed to update link" },
      { status: 500 },
    );
  }
}
