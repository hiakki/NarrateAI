import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { sendEmail, buildVerificationEmail } from "@/lib/email/send";
import { randomInt } from "crypto";

const CODE_EXPIRY_MS = 10 * 60 * 1000; // 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000;  // 1 minute between sends
const MAX_ATTEMPTS = 5;

function generateCode(): string {
  return String(randomInt(100000, 999999));
}

/**
 * POST — Send a verification code to the authenticated user's email.
 */
export async function POST() {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerified: true, name: true },
    });

    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (user.emailVerified)
      return NextResponse.json({ error: "Email already verified" }, { status: 400 });

    // Rate limit: check last code sent
    const recentCode = await db.emailVerification.findFirst({
      where: { email: user.email, used: false },
      orderBy: { createdAt: "desc" },
    });

    if (recentCode && Date.now() - recentCode.createdAt.getTime() < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (Date.now() - recentCode.createdAt.getTime())) / 1000);
      return NextResponse.json(
        { error: `Please wait ${waitSec}s before requesting a new code` },
        { status: 429 },
      );
    }

    const code = generateCode();

    await db.emailVerification.create({
      data: {
        email: user.email,
        code,
        expiresAt: new Date(Date.now() + CODE_EXPIRY_MS),
      },
    });

    const { subject, html, text } = buildVerificationEmail(code, user.name ?? undefined);
    const sent = await sendEmail({ to: user.email, subject, html, text });

    if (!sent) {
      return NextResponse.json(
        { error: "Failed to send verification email. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      success: true,
      message: "Verification code sent",
      email: user.email.replace(/(.{2})(.*)(@.*)/, "$1***$3"),
    });
  } catch (error) {
    console.error("Send verification error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}

/**
 * PATCH — Verify the code.
 */
export async function PATCH(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const code = String(body.code ?? "").trim();

    if (!code || code.length !== 6) {
      return NextResponse.json(
        { error: "Please enter a 6-digit code" },
        { status: 400 },
      );
    }

    const user = await db.user.findUnique({
      where: { id: session.user.id },
      select: { email: true, emailVerified: true },
    });

    if (!user)
      return NextResponse.json({ error: "User not found" }, { status: 404 });

    if (user.emailVerified)
      return NextResponse.json({ error: "Email already verified" }, { status: 400 });

    const verification = await db.emailVerification.findFirst({
      where: {
        email: user.email,
        used: false,
        expiresAt: { gte: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!verification) {
      return NextResponse.json(
        { error: "No active verification code found. Please request a new one." },
        { status: 400 },
      );
    }

    if (verification.attempts >= MAX_ATTEMPTS) {
      await db.emailVerification.update({
        where: { id: verification.id },
        data: { used: true },
      });
      return NextResponse.json(
        { error: "Too many attempts. Please request a new code." },
        { status: 429 },
      );
    }

    if (verification.code !== code) {
      await db.emailVerification.update({
        where: { id: verification.id },
        data: { attempts: { increment: 1 } },
      });
      const remaining = MAX_ATTEMPTS - verification.attempts - 1;
      return NextResponse.json(
        { error: `Invalid code. ${remaining} attempt${remaining === 1 ? "" : "s"} remaining.` },
        { status: 400 },
      );
    }

    // Code matches — mark as verified
    await Promise.all([
      db.emailVerification.update({
        where: { id: verification.id },
        data: { used: true },
      }),
      db.user.update({
        where: { id: session.user.id },
        data: { emailVerified: true },
      }),
    ]);

    return NextResponse.json({ success: true, message: "Email verified successfully" });
  } catch (error) {
    console.error("Verify code error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 },
    );
  }
}
