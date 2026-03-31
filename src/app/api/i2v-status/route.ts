import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getI2VProviderStatus } from "@/services/image-to-video";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const providers = getI2VProviderStatus();
  return NextResponse.json({ providers });
}
