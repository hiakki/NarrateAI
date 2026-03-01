import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveProviders } from "@/services/providers/resolve";
import { getImageProvider } from "@/services/providers/factory";
import { createLogger } from "@/lib/logger";
import fs from "fs/promises";

const log = createLogger("API:CharPreview");

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const character = await db.character.findUnique({ where: { id } });

    if (!character)
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    if (character.userId !== session.user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { defaultLlmProvider: true, defaultTtsProvider: true, defaultImageProvider: true },
    });

    const providers = resolveProviders(null, user);
    const imgProvider = getImageProvider(providers.image);

    const prompt = `${character.fullPrompt}, standing in a neutral studio background, full body portrait, facing camera, vertical 9:16, masterpiece, ultra-detailed, 8k resolution, cinematic lighting`;

    const result = await imgProvider.generateImages(
      [{ visualDescription: prompt }],
      "cinematic, high quality",
      "low quality, blurry, watermark, text, multiple characters",
    );

    if (!result.imagePaths.length)
      return NextResponse.json({ error: "Image generation failed" }, { status: 500 });

    const srcPath = result.imagePaths[0];
    const ext = srcPath.split(".").pop() || "png";
    const destDir = `public/characters/${character.userId}`;
    const destFile = `${id}.${ext}`;
    const destPath = `${destDir}/${destFile}`;
    const absDir = `${process.cwd()}/${destDir}`;
    const absDest = `${process.cwd()}/${destPath}`;

    await fs.mkdir(absDir, { recursive: true });
    await fs.copyFile(srcPath, absDest);

    const previewUrl = `/characters/${character.userId}/${destFile}`;
    await db.character.update({ where: { id }, data: { previewUrl } });

    log.log(`Preview generated for character "${character.name}" → ${previewUrl}`);

    return NextResponse.json({ data: { previewUrl } });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Preview generation failed: ${msg.slice(0, 200)}`);
    return NextResponse.json({ error: "Failed to generate preview" }, { status: 500 });
  }
}
