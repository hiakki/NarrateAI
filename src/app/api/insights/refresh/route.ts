import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { refreshInsightsForUser } from "@/services/insights";

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: { automationId?: string; videoIds?: string[] } = {};
    try {
      const raw = await req.json();
      if (raw && typeof raw === "object") {
        if (typeof raw.automationId === "string") body.automationId = raw.automationId;
        if (Array.isArray(raw.videoIds)) body.videoIds = raw.videoIds.filter((id: unknown) => typeof id === "string");
      }
    } catch {
      // no body or invalid JSON is fine — refresh all
    }

    const result = await refreshInsightsForUser(session.user.id, body);

    return NextResponse.json({
      data: {
        refreshedAt: result.refreshedAt.toISOString(),
        videoCount: result.videoCount,
        errors: result.errors.length ? result.errors : undefined,
      },
    });
  } catch (error) {
    console.error("Insights refresh error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh insights" },
      { status: 500 },
    );
  }
}
