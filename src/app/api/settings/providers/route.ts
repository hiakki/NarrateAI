import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  LLM_PROVIDERS,
  TTS_PROVIDERS,
  IMAGE_PROVIDERS,
  PLATFORM_DEFAULTS,
  getAvailableProviders,
} from "@/config/providers";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: {
        defaultLlmProvider: true,
        defaultTtsProvider: true,
        defaultImageProvider: true,
      },
    });

    return NextResponse.json({
      data: {
        defaults: {
          llmProvider: user?.defaultLlmProvider ?? null,
          ttsProvider: user?.defaultTtsProvider ?? null,
          imageProvider: user?.defaultImageProvider ?? null,
        },
        platformDefaults: PLATFORM_DEFAULTS,
        available: {
          llm: getAvailableProviders("llm"),
          tts: getAvailableProviders("tts"),
          image: getAvailableProviders("image"),
        },
        all: {
          llm: Object.values(LLM_PROVIDERS),
          tts: Object.values(TTS_PROVIDERS),
          image: Object.values(IMAGE_PROVIDERS),
        },
      },
    });
  } catch (error) {
    console.error("Get providers error:", error);
    return NextResponse.json({ error: "Failed to load providers" }, { status: 500 });
  }
}

const VALID_LLM = new Set(Object.keys(LLM_PROVIDERS));
const VALID_TTS = new Set(Object.keys(TTS_PROVIDERS));
const VALID_IMAGE = new Set(Object.keys(IMAGE_PROVIDERS));

export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { llmProvider, ttsProvider, imageProvider } = body;

    if (llmProvider !== undefined && llmProvider !== null && !VALID_LLM.has(llmProvider)) {
      return NextResponse.json({ error: `Invalid LLM provider: ${llmProvider}` }, { status: 400 });
    }
    if (ttsProvider !== undefined && ttsProvider !== null && !VALID_TTS.has(ttsProvider)) {
      return NextResponse.json({ error: `Invalid TTS provider: ${ttsProvider}` }, { status: 400 });
    }
    if (imageProvider !== undefined && imageProvider !== null && !VALID_IMAGE.has(imageProvider)) {
      return NextResponse.json({ error: `Invalid Image provider: ${imageProvider}` }, { status: 400 });
    }

    const updateData: Record<string, string | null> = {};
    if (llmProvider !== undefined) updateData.defaultLlmProvider = llmProvider;
    if (ttsProvider !== undefined) updateData.defaultTtsProvider = ttsProvider;
    if (imageProvider !== undefined) updateData.defaultImageProvider = imageProvider;

    const updated = await db.user.update({
      where: { id: session.user.id },
      data: updateData as never,
      select: {
        defaultLlmProvider: true,
        defaultTtsProvider: true,
        defaultImageProvider: true,
      },
    });

    return NextResponse.json({
      data: {
        llmProvider: updated.defaultLlmProvider,
        ttsProvider: updated.defaultTtsProvider,
        imageProvider: updated.defaultImageProvider,
      },
    });
  } catch (error) {
    console.error("Update providers error:", error);
    return NextResponse.json({ error: "Failed to update providers" }, { status: 500 });
  }
}
