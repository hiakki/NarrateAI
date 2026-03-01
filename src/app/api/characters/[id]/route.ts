import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod/v4";

const updateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  type: z.string().optional(),
  physical: z.string().optional(),
  clothing: z.string().optional(),
  accessories: z.string().optional(),
  features: z.string().optional(),
  personality: z.string().optional(),
  fullPrompt: z.string().min(1).max(2000).optional(),
});

export async function GET(
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

    return NextResponse.json({ data: character });
  } catch {
    return NextResponse.json({ error: "Failed to fetch character" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const existing = await db.character.findUnique({ where: { id } });

    if (!existing)
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    if (existing.userId !== session.user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const parsed = updateSchema.parse(body);

    const updated = await db.character.update({
      where: { id },
      data: parsed,
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    if (err instanceof z.ZodError)
      return NextResponse.json({ error: err.issues[0].message }, { status: 400 });
    return NextResponse.json({ error: "Failed to update character" }, { status: 500 });
  }
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const existing = await db.character.findUnique({ where: { id } });

    if (!existing)
      return NextResponse.json({ error: "Character not found" }, { status: 404 });
    if (existing.userId !== session.user.id)
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    await db.character.delete({ where: { id } });

    return NextResponse.json({ data: { success: true } });
  } catch {
    return NextResponse.json({ error: "Failed to delete character" }, { status: 500 });
  }
}
