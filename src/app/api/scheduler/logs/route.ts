import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { automationLogDir, listLogDates, readLogFile } from "@/lib/file-logger";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const automationId = req.nextUrl.searchParams.get("automationId");
  if (!automationId) {
    return NextResponse.json({ error: "automationId is required" }, { status: 400 });
  }

  const auto = await db.automation.findUnique({
    where: { id: automationId },
    select: {
      id: true,
      name: true,
      user: { select: { id: true, name: true, email: true } },
    },
  });

  if (!auto || auto.user.id !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const logDir = automationLogDir(
    auto.user.id,
    auto.user.name ?? auto.user.email?.split("@")[0] ?? "user",
    auto.id,
    auto.name,
  );

  const date = req.nextUrl.searchParams.get("date");

  if (!date) {
    const dates = await listLogDates(logDir);
    return NextResponse.json({ dates });
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid date format (YYYY-MM-DD)" }, { status: 400 });
  }

  const content = await readLogFile(logDir, date);
  if (content === null) {
    return NextResponse.json({ content: "", message: "No logs for this date" });
  }

  return NextResponse.json({ content });
}
