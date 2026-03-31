import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id)
      return NextResponse.json({ verified: false }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { emailVerified: true },
    });

    return NextResponse.json({ verified: !!user?.emailVerified });
  } catch {
    return NextResponse.json({ verified: true });
  }
}
