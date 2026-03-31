#!/usr/bin/env node
/**
 * Calls Meta APIs using tokens from the DB (no browser/auth needed).
 * Run: node scripts/test-insights-from-db.mjs [videoId]
 *   With videoId: tests that video's FB/IG links.
 *   Without: uses default test IDs (FB 769423079574206, IG DVQO3ahiL-L).
 * Requires: DATABASE_URL, SOCIAL_TOKEN_SECRET in .env.
 */

import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "@prisma/client";

function postIdFromUrl(platform, url) {
  if (!url || typeof url !== "string") return null;
  const u = url.trim();
  if (platform === "INSTAGRAM") {
    const m = u.match(/instagram\.com\/reels?\/([^/?]+)/i) ?? u.match(/instagram\.com\/p\/([^/?]+)/i);
    return m ? m[1].replace(/\/$/, "") : null;
  }
  if (platform === "FACEBOOK") {
    const m = u.match(/facebook\.com\/reel\/(\d+)/i) ?? u.match(/reel\/(\d+)/i);
    return m ? m[1] : null;
  }
  return null;
}

function parsePostedPlatforms(raw) {
  const map = new Map();
  const arr = Array.isArray(raw) ? raw : [];
  for (const p of arr) {
    if (typeof p === "string") continue;
    const platform = p?.platform;
    let postId = p?.postId ?? null;
    if (!postId && p?.url) postId = postIdFromUrl(platform, p.url);
    if (platform && postId) map.set(platform, String(postId));
  }
  return map;
}

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

const GRAPH = "https://graph.facebook.com/v21.0";
const db = new PrismaClient();

async function main() {
  if (!process.env.SOCIAL_TOKEN_SECRET) {
    console.error("Missing SOCIAL_TOKEN_SECRET in .env");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("Missing DATABASE_URL in .env");
    process.exit(1);
  }

  const videoId = process.argv[2] || process.env.VIDEO_ID;
  let fbPostId = "769423079574206";
  let igPostId = "DVQO3ahiL-L"; // shortcode for default test

  if (videoId) {
    const video = await db.video.findUnique({
      where: { id: videoId },
      select: { id: true, postedPlatforms: true, series: { select: { userId: true } } },
    });
    if (!video) {
      console.error("Video not found:", videoId);
      process.exit(1);
    }
    const parsed = parsePostedPlatforms(video.postedPlatforms);
    fbPostId = parsed.get("FACEBOOK") || fbPostId;
    igPostId = parsed.get("INSTAGRAM") || igPostId;
    console.log("=== Video", videoId, "===\nFB postId:", fbPostId || "(none)");
    console.log("IG postId:", igPostId || "(none)\n");
  }

  const fb = await db.socialAccount.findFirst({
    where: { platform: "FACEBOOK" },
    select: { accessTokenEnc: true },
  });
  const ig = await db.socialAccount.findFirst({
    where: { platform: "INSTAGRAM" },
    select: { accessTokenEnc: true, platformUserId: true },
  });

  console.log("=== From DB ===\nFacebook:", fb ? "found" : "none");
  console.log("Instagram:", ig ? "found" : "none\n");

  const out = {};

  if (fb?.accessTokenEnc && fbPostId) {
    try {
      const token = decrypt(fb.accessTokenEnc);
      console.log("--- Facebook", fbPostId, "---\n");

      const videoRes = await fetch(
        `${GRAPH}/${fbPostId}?fields=comments.summary(total_count),likes.summary(total_count)&access_token=${encodeURIComponent(token)}`,
      );
      out.fbVideoNode = await videoRes.json().catch(() => ({}));
      console.log("1) Video node:", JSON.stringify(out.fbVideoNode, null, 2).slice(0, 600));

      const ins1Res = await fetch(
        `${GRAPH}/${fbPostId}/video_insights?metric=total_video_views&period=lifetime&access_token=${encodeURIComponent(token)}`,
      );
      out.fbInsightsTotalViews = await ins1Res.json().catch(() => null);
      console.log("\n2) video_insights total_video_views:", JSON.stringify(out.fbInsightsTotalViews, null, 2).slice(0, 600));

      const ins2Res = await fetch(
        `${GRAPH}/${fbPostId}/video_insights?metric=fb_reels_total_plays&period=lifetime&access_token=${encodeURIComponent(token)}`,
      );
      out.fbInsightsReelsPlays = await ins2Res.json().catch(() => null);
      console.log("\n3) video_insights fb_reels_total_plays:", JSON.stringify(out.fbInsightsReelsPlays, null, 2).slice(0, 600));
    } catch (e) {
      out.fbError = e.message;
      console.error("Facebook error:", e.message);
    }
  } else if (videoId && !fbPostId) {
    console.log("--- Facebook: no link for this video ---\n");
  }

  if (ig?.accessTokenEnc && ig.platformUserId && igPostId) {
    try {
      const token = decrypt(ig.accessTokenEnc);
      console.log("\n--- Instagram", igPostId, "---\n");

      const listRes = await fetch(
        `${GRAPH}/${ig.platformUserId}/media?fields=id,permalink&limit=50&access_token=${encodeURIComponent(token)}`,
      );
      const listJson = await listRes.json().catch(() => null);
      out.igMediaList = listJson;
      const list = Array.isArray(listJson?.data) ? listJson.data : [];
      const isNumeric = /^\d+$/.test(igPostId);
      const found = isNumeric
        ? list.find((m) => m.id === igPostId)
        : list.find(
            (m) =>
              (m.permalink || "").includes(igPostId) || (m.permalink || "").toLowerCase().includes(String(igPostId).toLowerCase()),
          );
      const mediaId = found ? found.id : isNumeric ? igPostId : null;

      if (mediaId) {
        console.log("1) Media id:", mediaId);
        const mediaRes = await fetch(
          `${GRAPH}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(token)}`,
        );
        out.igMediaNode = await mediaRes.json().catch(() => null);
        console.log("2) Media node:", JSON.stringify(out.igMediaNode));

        const insightsRes = await fetch(
          `${GRAPH}/${mediaId}/insights?metric=views&period=lifetime&access_token=${encodeURIComponent(token)}`,
        );
        out.igInsights = await insightsRes.json().catch(() => null);
        console.log("3) Insights views:", JSON.stringify(out.igInsights));
      } else {
        console.log("1) Media id not found for", igPostId, "(list length:", list.length, ")");
      }
    } catch (e) {
      out.igError = e.message;
      console.error("Instagram error:", e.message);
    }
  } else if (videoId && !igPostId) {
    console.log("\n--- Instagram: no link for this video ---\n");
  }

  console.log("\n=== Full JSON ===\n");
  console.log(JSON.stringify(out, null, 2));
  await db.$disconnect();
}

main();
