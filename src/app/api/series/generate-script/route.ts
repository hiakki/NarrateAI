import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { generateScript } from "@/services/script-generator";
import { resolveProviders } from "@/services/providers/resolve";
import { z } from "zod/v4";

const schema = z.object({
  niche: z.string().min(1),
  tone: z.string().min(1),
  artStyle: z.string().min(1),
  duration: z.number().min(15).max(120),
  topic: z.string().optional(),
  language: z.string().optional(),
  llmProvider: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const input = schema.parse(body);

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { defaultLlmProvider: true, defaultTtsProvider: true, defaultImageProvider: true },
    });

    const resolved = resolveProviders(
      { llmProvider: input.llmProvider ?? null, ttsProvider: null, imageProvider: null },
      user
    );

    const script = await generateScript(input, resolved.llm);

    return NextResponse.json({ data: script });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    }
    console.error("Script generation error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate script" },
      { status: 500 }
    );
  }
}
