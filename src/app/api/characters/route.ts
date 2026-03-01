import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";

const createSchema = z.object({
  name: z.string().min(1).max(100),
  type: z.string().default("human"),
  physical: z.string().optional(),
  clothing: z.string().optional(),
  accessories: z.string().optional(),
  features: z.string().optional(),
  personality: z.string().optional(),
  fullPrompt: z.string().min(1).max(2000),
});

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const characters = await db.character.findMany({
      where: { userId: session.user.id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        physical: true,
        clothing: true,
        accessories: true,
        features: true,
        personality: true,
        fullPrompt: true,
        previewUrl: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { series: true, automations: true } },
      },
    });

    return NextResponse.json({ data: characters });
  } catch {
    return NextResponse.json({ error: "Failed to fetch characters" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = createSchema.parse(body);

    const character = await db.character.create({
      data: { userId: session.user.id, ...parsed },
    });

    return NextResponse.json({ data: character }, { status: 201 });
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Failed to create character" }, { status: 500 });
  }
}
