#!/usr/bin/env node
/**
 * YouTube permissions diagnostic script.
 *
 * 1. Loads the stored YouTube token from the DB.
 * 2. Calls Google tokeninfo to see what scopes the token has.
 * 3. Tries the exact API calls the app needs (channels.list for name, channels.list for subs, videos.list for stats).
 * 4. Prints what passed/failed and step-by-step fix instructions.
 *
 * Run: node scripts/test-youtube-permissions.mjs
 * Requires: .env with DATABASE_URL, SOCIAL_TOKEN_SECRET.
 * Optional: GOOGLE_API_KEY or YOUTUBE_API_KEY (append &key= to requests if set).
 */

import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function decrypt(ciphertext) {
  const secret = process.env.SOCIAL_TOKEN_SECRET;
  if (!secret) throw new Error("SOCIAL_TOKEN_SECRET env var is required");
  const key = crypto.scryptSync(secret, "narrateai-salt", 32);
  const buf = Buffer.from(ciphertext, "base64");
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const encrypted = buf.subarray(IV_LENGTH + TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(encrypted) + decipher.final("utf8");
}

const db = new PrismaClient();

const NEEDS = {
  channelName: "channels.list(part=snippet, mine=true) — used when connecting to show your channel name",
  channelSubs: "channels.list(part=statistics, id=CHANNEL_ID) — used for insights subscriber count",
  videoStats: "videos.list(part=statistics, id=VIDEO_ID) — used for insights views/likes/comments",
  perVideoSubs: "YouTube Analytics API (reports) — subscribersGained per video (same as Studio)",
};

const SCOPES_NEEDED = [
  "https://www.googleapis.com/auth/youtube.readonly — required for channels.list and videos.list (read)",
  "https://www.googleapis.com/auth/youtube.force-ssl — often required for mine=true and full read/write",
  "https://www.googleapis.com/auth/youtube.upload — required for uploading Shorts",
];

async function run() {
  console.log("=== YouTube permissions diagnostic ===\n");

  if (!process.env.DATABASE_URL || !process.env.SOCIAL_TOKEN_SECRET) {
    console.error("Missing .env: need DATABASE_URL and SOCIAL_TOKEN_SECRET.");
    process.exit(1);
  }

  const account = await db.socialAccount.findFirst({
    where: { platform: "YOUTUBE" },
    select: {
      id: true,
      platformUserId: true,
      username: true,
      accessTokenEnc: true,
      refreshTokenEnc: true,
      tokenExpiresAt: true,
    },
  });

  if (!account?.accessTokenEnc) {
    console.log("No YouTube account found in the database. Connect YouTube in the app first (Dashboard → Channels).");
    await db.$disconnect();
    return;
  }

  let accessToken;
  try {
    accessToken = decrypt(account.accessTokenEnc);
  } catch (e) {
    console.error("Failed to decrypt token:", e.message);
    await db.$disconnect();
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.YOUTUBE_API_KEY ?? "";
  const keySuffix = apiKey ? `&key=${encodeURIComponent(apiKey)}` : "";

  console.log("Stored account:", account.platformUserId === "unknown" ? "channel ID unknown" : account.platformUserId);
  console.log("Username in DB:", account.username ?? "(null)");
  console.log("Token expires:", account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toISOString() : "unknown");
  console.log("API key in .env:", apiKey ? "set" : "not set (optional for quota)");
  console.log("");

  // --- Step 1: Token info (what scopes does this token have?)
  console.log("--- 1. Token info (what scopes did Google grant?) ---");
  let tokenInfo = null;
  try {
    const tr = await fetch(
      `https://www.googleapis.com/oauth2/v1/tokeninfo?access_token=${encodeURIComponent(accessToken)}`
    );
    tokenInfo = await tr.json();
    if (tr.ok) {
      console.log("  Scope:", tokenInfo.scope ?? "(none)");
      console.log("  Audience:", tokenInfo.audience ?? "");
      console.log("  Expires in:", tokenInfo.expires_in ? `${tokenInfo.expires_in}s` : "");
    } else {
      console.log("  tokeninfo failed:", tokenInfo.error ?? tokenInfo);
    }
  } catch (e) {
    console.log("  tokeninfo error:", e.message);
  }
  console.log("");

  // --- Step 2: channels.list part=snippet mine=true (channel name)
  console.log("--- 2. Channel name (channels.list part=snippet, mine=true) ---");
  const channelsSnippetUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true${keySuffix}`;
  const r1 = await fetch(channelsSnippetUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const d1 = await r1.json();
  if (r1.ok && d1.items?.length) {
    const ch = d1.items[0];
    console.log("  OK — Channel:", ch.snippet?.title ?? ch.id);
    console.log("  Channel ID:", ch.id);
  } else {
    console.log("  FAILED — Status:", r1.status, r1.statusText);
    if (d1.error) {
      console.log("  Error code:", d1.error.code);
      console.log("  Message:", d1.error.message);
      if (d1.error.errors?.length) {
        d1.error.errors.forEach((err) => console.log("  Reason:", err.reason, err.message));
      }
    }
  }
  console.log("");

  // --- Step 3: channels.list part=statistics (subscriber count)
  const channelId = d1?.items?.[0]?.id ?? account.platformUserId;
  console.log("--- 3. Channel stats / subscribers (channels.list part=statistics) ---");
  if (channelId && channelId !== "unknown") {
    const channelsStatsUrl = `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}${keySuffix}`;
    const r2 = await fetch(channelsStatsUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const d2 = await r2.json();
    if (r2.ok && d2.items?.length) {
      const subCount = d2.items[0].statistics?.subscriberCount ?? "0";
      console.log("  OK — Subscribers:", subCount);
    } else {
      console.log("  FAILED — Status:", r2.status);
      if (d2.error) console.log("  Message:", d2.error.message);
    }
  } else {
    console.log("  SKIP — No channel ID (step 2 failed or stored ID is 'unknown')");
  }
  console.log("");

  // --- Step 4: videos.list part=statistics (video stats for insights)
  console.log("--- 4. Video statistics (videos.list part=statistics) ---");
  const testVideoId = "dQw4w9WgXcQ"; // public video; we only need to confirm the API accepts the token
  const videosUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${testVideoId}${keySuffix}`;
  const r3 = await fetch(videosUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const d3 = await r3.json();
  if (r3.ok) {
    const item = d3.items?.[0];
    console.log("  OK — Request allowed. Example viewCount:", item?.statistics?.viewCount ?? "n/a");
  } else {
    console.log("  FAILED — Status:", r3.status);
    if (d3.error) {
      console.log("  Message:", d3.error.message);
      if (d3.error.errors?.length) {
        d3.error.errors.forEach((err) => console.log("  Reason:", err.reason, err.message));
      }
    }
  }
  console.log("");

  // --- Summary and fix guide
  const firstErrorReason = d1.error?.errors?.[0]?.reason ?? d3.error?.errors?.[0]?.reason ?? "";
  const isSignupRequired = firstErrorReason === "youtubeSignupRequired";

  console.log("=== What the app needs ===\n");
  Object.entries(NEEDS).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  console.log("\n=== Scopes your token has (from tokeninfo) ===\n");
  if (tokenInfo?.scope) {
    tokenInfo.scope.split(" ").forEach((s) => console.log("  " + s));
  } else {
    console.log("  (could not read)");
  }
  console.log("\n=== Scopes the app requests when you connect ===\n");
  SCOPES_NEEDED.forEach((s) => console.log("  " + s));
  console.log("\n=== How to fix ===\n");

  if (isSignupRequired) {
    console.log("  REASON: youtubeSignupRequired — This Google account does not have a YouTube channel yet.");
    console.log("");
    console.log("  1. Sign in to https://www.youtube.com with the same Google account you use to connect in the app.");
    console.log("  2. If prompted, create a YouTube channel (Create Channel / Get started).");
    console.log("  3. In the app: Dashboard → Channels → disconnect YouTube, then connect again.");
    console.log("");
  }

  console.log("  General 401 / Unauthorized:");
  console.log("  1. Google Cloud Console → your project → APIs & Services → Library.");
  console.log("     Enable: YouTube Data API v3.");
  console.log("  2. Credentials → OAuth 2.0 Client ID → Authorized redirect URIs must include your callback URL.");
  console.log("  3. OAuth consent screen: if in 'Testing', add your Google account as a test user.");
  console.log("  4. Disconnect and reconnect YouTube in the app after any change.");
  if (!apiKey) {
    console.log("  5. (Optional) Create an API key, enable YouTube Data API v3 for it, set GOOGLE_API_KEY in .env.");
  }
  console.log("");

  await db.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
