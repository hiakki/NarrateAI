import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDataCookiePath } from "@/lib/cookie-path";
import fs from "fs/promises";
import path from "path";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookiePath = getDataCookiePath();
    let exists = false;
    let lineCount = 0;
    let fbConnected = false;
    let igConnected = false;
    let fbCookieCount = 0;
    let igCookieCount = 0;
    try {
      const content = await fs.readFile(cookiePath, "utf-8");
      exists = true;
      const dataLines = content.split("\n").filter((l) => l.trim() && !l.startsWith("#"));
      lineCount = dataLines.length;

      for (const line of dataLines) {
        const domain = line.split("\t")[0]?.toLowerCase() ?? "";
        if (domain.includes("facebook.com") || domain.includes(".fb.com")) {
          fbCookieCount++;
        }
        if (domain.includes("instagram.com")) {
          igCookieCount++;
        }
      }
      fbConnected = fbCookieCount >= 3;
      igConnected = igCookieCount >= 3;
    } catch {
      exists = false;
    }

    const envConfigured = !!process.env.YTDLP_COOKIES_FILE;

    return NextResponse.json({
      data: { exists, lineCount, envConfigured, fbConnected, igConnected, fbCookieCount, igCookieCount },
    });
  } catch (error) {
    console.error("Get cookies status error:", error);
    return NextResponse.json({ error: "Failed to check cookies" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { cookieText } = body as { cookieText?: string };

    if (!cookieText || typeof cookieText !== "string" || cookieText.trim().length < 10) {
      return NextResponse.json({ error: "Invalid cookie content" }, { status: 400 });
    }

    const lines = cookieText.trim().split("\n");
    const dataLines = lines.filter((l) => l.trim() && !l.startsWith("#"));
    if (dataLines.length === 0) {
      return NextResponse.json({ error: "No valid cookie entries found. Ensure Netscape cookie format." }, { status: 400 });
    }

    const hasTabSeparated = dataLines.some((l) => l.split("\t").length >= 6);
    if (!hasTabSeparated) {
      return NextResponse.json(
        { error: "Cookies must be in Netscape/Mozilla format (tab-separated). Use a browser extension like 'Get cookies.txt LOCALLY'." },
        { status: 400 },
      );
    }

    const cookiePath = getDataCookiePath();
    await fs.mkdir(path.dirname(cookiePath), { recursive: true });
    await fs.writeFile(cookiePath, cookieText.trim() + "\n", "utf-8");

    return NextResponse.json({
      data: { saved: true, lineCount: dataLines.length },
    });
  } catch (error) {
    console.error("Save cookies error:", error);
    return NextResponse.json({ error: "Failed to save cookies" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const cookiePath = getDataCookiePath();
    try {
      await fs.unlink(cookiePath);
    } catch {
      // File doesn't exist, that's fine
    }

    return NextResponse.json({ data: { deleted: true } });
  } catch (error) {
    console.error("Delete cookies error:", error);
    return NextResponse.json({ error: "Failed to delete cookies" }, { status: 500 });
  }
}
