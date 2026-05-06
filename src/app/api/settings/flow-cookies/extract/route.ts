import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

let activeExtraction: { startedAt: number; promise: Promise<void> } | null = null;
let lastResult: { success: boolean; message: string; cookieCount: number; completedAt: number } | null = null;

export async function POST() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (activeExtraction && Date.now() - activeExtraction.startedAt < 8 * 60 * 1000) {
    return NextResponse.json({ data: { status: "in_progress", message: "Flow Google login already in progress..." } });
  }

  const { extractFlowCookiesViaGoogleLogin } = await import("@/lib/flow-cookie-extract");

  lastResult = null;
  const startedAt = Date.now();
  const promise = (async () => {
    try {
      const result = await extractFlowCookiesViaGoogleLogin();
      lastResult = { ...result, completedAt: Date.now() };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastResult = { success: false, message: msg, cookieCount: 0, completedAt: Date.now() };
    } finally {
      activeExtraction = null;
    }
  })();

  activeExtraction = { startedAt, promise };
  return NextResponse.json({
    data: {
      status: "started",
      message: "Opening browser for Google login. Complete login in browser window.",
    },
  });
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (activeExtraction) {
    const elapsed = Math.floor((Date.now() - activeExtraction.startedAt) / 1000);
    return NextResponse.json({
      data: { status: "in_progress", message: `Waiting for Google login... (${elapsed}s)`, elapsed },
    });
  }

  if (lastResult) {
    return NextResponse.json({
      data: {
        status: lastResult.success ? "done" : "error",
        message: lastResult.message,
        cookieCount: lastResult.cookieCount,
      },
    });
  }

  return NextResponse.json({ data: { status: "idle" } });
}
