import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accounts = await db.socialAccount.findMany({
      where: { userId: session.user.id },
      select: {
        id: true,
        platform: true,
        username: true,
        pageName: true,
        profileUrl: true,
        connectedAt: true,
        tokenExpiresAt: true,
      },
      orderBy: { connectedAt: "desc" },
    });

    return NextResponse.json({ data: accounts });
  } catch (error) {
    console.error("Get social accounts error:", error);
    return NextResponse.json(
      { error: "Failed to load accounts" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await req.json();
    if (!id)
      return NextResponse.json(
        { error: "Account id required" },
        { status: 400 },
      );

    const account = await db.socialAccount.findUnique({ where: { id } });
    if (!account || account.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.socialAccount.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete social account error:", error);
    return NextResponse.json(
      { error: "Failed to disconnect account" },
      { status: 500 },
    );
  }
}
