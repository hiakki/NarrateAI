import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

let activeExtraction: { promise: Promise<unknown>; startedAt: number } | null = null;
let lastResult: { success: boolean; message: string; cookieCount: number; completedAt: number } | null = null;

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (activeExtraction && Date.now() - activeExtraction.startedAt < 300_000) {
      return NextResponse.json({ data: { status: "in_progress", message: "Browser login already in progress..." } });
    }

    const body = await req.json().catch(() => ({}));
    const platform = (body as { platform?: string }).platform === "instagram" ? "instagram" as const
      : (body as { platform?: string }).platform === "both" ? "both" as const
      : "facebook" as const;

    const { extractPlatformCookies } = await import("@/lib/cookie-extract");

    lastResult = null;
    const startedAt = Date.now();

    const extractionPromise = extractPlatformCookies(platform).then((result) => {
      lastResult = { ...result, completedAt: Date.now() };
      activeExtraction = null;
      return result;
    }).catch((err) => {
      lastResult = { success: false, message: String(err), cookieCount: 0, completedAt: Date.now() };
      activeExtraction = null;
    });

    activeExtraction = { promise: extractionPromise, startedAt };

    return NextResponse.json({
      data: { status: "started", message: "Opening browser window... Please log in when it appears." },
    });
  } catch (error) {
    console.error("Cookie extraction error:", error);
    return NextResponse.json({ error: "Failed to start extraction" }, { status: 500 });
  }
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (activeExtraction) {
      const elapsed = Math.floor((Date.now() - activeExtraction.startedAt) / 1000);
      return NextResponse.json({
        data: { status: "in_progress", message: `Waiting for login... (${elapsed}s)`, elapsed },
      });
    }

    if (lastResult) {
      const result = lastResult;
      return NextResponse.json({
        data: {
          status: result.success ? "done" : "error",
          message: result.message,
          cookieCount: result.cookieCount,
        },
      });
    }

    return NextResponse.json({ data: { status: "idle" } });
  } catch (error) {
    console.error("Cookie extraction status error:", error);
    return NextResponse.json({ error: "Failed to check status" }, { status: 500 });
  }
}
