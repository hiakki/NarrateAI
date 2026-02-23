import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { isPrivilegedRole } from "@/lib/permissions";
import {
  LLM_PROVIDERS,
  TTS_PROVIDERS,
  IMAGE_PROVIDERS,
} from "@/config/providers";

async function getOrCreateSettings() {
  let settings = await db.adminSettings.findUnique({
    where: { id: "singleton" },
  });
  if (!settings) {
    settings = await db.adminSettings.create({
      data: {
        id: "singleton",
        enabledLlmProviders: Object.keys(LLM_PROVIDERS),
        enabledTtsProviders: Object.keys(TTS_PROVIDERS),
        enabledImageProviders: Object.keys(IMAGE_PROVIDERS),
      },
    });
  }
  return settings;
}

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user || !isPrivilegedRole(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const settings = await getOrCreateSettings();

    return NextResponse.json({
      data: {
        enabledLlmProviders: settings.enabledLlmProviders as string[],
        enabledTtsProviders: settings.enabledTtsProviders as string[],
        enabledImageProviders: settings.enabledImageProviders as string[],
        allProviders: {
          llm: Object.values(LLM_PROVIDERS),
          tts: Object.values(TTS_PROVIDERS),
          image: Object.values(IMAGE_PROVIDERS),
        },
      },
    });
  } catch (error) {
    console.error("Admin get providers error:", error);
    return NextResponse.json(
      { error: "Failed to load admin settings" },
      { status: 500 },
    );
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || !isPrivilegedRole(session.user.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { enabledLlmProviders, enabledTtsProviders, enabledImageProviders } =
      body;

    await getOrCreateSettings();

    const updateData: Record<string, string[]> = {};
    if (enabledLlmProviders) updateData.enabledLlmProviders = enabledLlmProviders;
    if (enabledTtsProviders) updateData.enabledTtsProviders = enabledTtsProviders;
    if (enabledImageProviders) updateData.enabledImageProviders = enabledImageProviders;

    const updated = await db.adminSettings.update({
      where: { id: "singleton" },
      data: updateData,
    });

    return NextResponse.json({
      data: {
        enabledLlmProviders: updated.enabledLlmProviders,
        enabledTtsProviders: updated.enabledTtsProviders,
        enabledImageProviders: updated.enabledImageProviders,
      },
    });
  } catch (error) {
    console.error("Admin update providers error:", error);
    return NextResponse.json(
      { error: "Failed to update admin settings" },
      { status: 500 },
    );
  }
}
