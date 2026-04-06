import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import fs from "fs/promises";
import path from "path";
import crypto from "crypto";
import { getFlowDataCookiePath } from "@/lib/flow-cookie-path";

interface FlowCookieMeta {
  savedAt?: string | null;
  cookieCount?: number;
  fingerprint?: string | null;
}

const META_PATH = path.join(process.cwd(), "data", "flow-cookie-meta.json");

type BrowserCookie = {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
};

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseCookies(input: string): BrowserCookie[] {
  const raw = JSON.parse(input) as unknown;
  const arr = Array.isArray(raw)
    ? raw
    : isRecord(raw) && Array.isArray(raw.cookies)
      ? raw.cookies
      : null;
  if (!arr) throw new Error("Expected JSON array of cookies or { cookies: [] }");

  const out: BrowserCookie[] = [];
  for (const c of arr) {
    if (!isRecord(c)) continue;
    const name = typeof c.name === "string" ? c.name.trim() : "";
    const value = typeof c.value === "string" ? c.value : "";
    if (!name) continue;
    const domain = typeof c.domain === "string" ? c.domain : ".labs.google";
    const pathValue = typeof c.path === "string" ? c.path : "/";
    const expires = typeof c.expires === "number" ? c.expires : -1;
    const httpOnly = typeof c.httpOnly === "boolean" ? c.httpOnly : false;
    const secure = typeof c.secure === "boolean" ? c.secure : true;
    const sameSiteRaw = typeof c.sameSite === "string" ? c.sameSite : "Lax";
    const sameSite = sameSiteRaw === "Strict" || sameSiteRaw === "None" ? sameSiteRaw : "Lax";
    out.push({ name, value, domain, path: pathValue, expires, httpOnly, secure, sameSite });
  }
  if (out.length === 0) throw new Error("No valid cookies found");
  return out;
}

function fp(cookies: BrowserCookie[]): string {
  const normalized = [...cookies]
    .map((c) => `${c.name}|${c.domain ?? ""}|${c.path ?? "/"}|${c.value}`)
    .sort()
    .join("\n");
  return crypto.createHash("md5").update(normalized).digest("hex");
}

async function readMeta(): Promise<FlowCookieMeta> {
  try {
    return JSON.parse(await fs.readFile(META_PATH, "utf-8"));
  } catch {
    return {};
  }
}

async function writeMeta(meta: FlowCookieMeta): Promise<void> {
  await fs.mkdir(path.dirname(META_PATH), { recursive: true });
  await fs.writeFile(META_PATH, JSON.stringify(meta, null, 2), "utf-8");
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookiePath = getFlowDataCookiePath();
  let exists = false;
  let cookieCount = 0;
  let earliestExpiry: string | null = null;

  try {
    const raw = await fs.readFile(cookiePath, "utf-8");
    const cookies = JSON.parse(raw) as BrowserCookie[];
    exists = Array.isArray(cookies) && cookies.length > 0;
    cookieCount = exists ? cookies.length : 0;
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = cookies
      .map((c) => (typeof c.expires === "number" ? c.expires : -1))
      .filter((v) => v > nowSec)
      .sort((a, b) => a - b)[0];
    if (exp) earliestExpiry = new Date(exp * 1000).toISOString();
  } catch {
    exists = false;
  }

  const meta = await readMeta();
  return NextResponse.json({
    data: {
      exists,
      cookieCount,
      savedAt: meta.savedAt ?? null,
      earliestExpiry,
      envConfigured: !!process.env.FLOW_TV_COOKIES_FILE,
    },
  });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const cookieJson = typeof body?.cookieJson === "string" ? body.cookieJson : "";
    if (!cookieJson.trim()) {
      return NextResponse.json({ error: "Missing cookieJson payload" }, { status: 400 });
    }

    const cookies = parseCookies(cookieJson);
    const cookiePath = getFlowDataCookiePath();
    await fs.mkdir(path.dirname(cookiePath), { recursive: true });
    await fs.writeFile(cookiePath, JSON.stringify(cookies, null, 2), "utf-8");

    const meta: FlowCookieMeta = {
      savedAt: new Date().toISOString(),
      cookieCount: cookies.length,
      fingerprint: fp(cookies),
    };
    await writeMeta(meta);

    return NextResponse.json({ data: { saved: true, cookieCount: cookies.length } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to save Flow cookies";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cookiePath = getFlowDataCookiePath();
  try { await fs.unlink(cookiePath); } catch {}
  try { await fs.unlink(META_PATH); } catch {}
  return NextResponse.json({ data: { deleted: true } });
}
