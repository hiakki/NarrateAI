#!/usr/bin/env node
/**
 * Verify insights for a video: DB state (postedPlatforms, insights).
 * Run: node scripts/verify-video-insights.mjs <videoId>
 */

import "dotenv/config";
import { PrismaClient } from "@prisma/client";

function parsePostedPlatforms(raw) {
  const map = new Map();
  const arr = Array.isArray(raw) ? raw : [];
  for (const p of arr) {
    if (typeof p === "string") continue;
    const platform = p?.platform;
    const postId = p?.postId ?? (p?.url ? postIdFromUrl(platform, p.url) : null);
    if (platform && postId) map.set(platform, String(postId));
  }
  return map;
}

function postIdFromUrl(platform, url) {
  if (!url || platform !== "YOUTUBE") return null;
  const m = url.match(/shorts\/([a-zA-Z0-9_-]+)/) ?? url.match(/[?&]v=([a-zA-Z0-9_-]+)/) ?? url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : null;
}

const db = new PrismaClient();

async function run() {
  const videoId = process.argv[2];
  if (!videoId) {
    console.log("Usage: node scripts/verify-video-insights.mjs <videoId>");
    process.exit(1);
  }

  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, status: true, postedPlatforms: true, insights: true, insightsRefreshedAt: true },
  });
  if (!video) {
    console.log("Video not found:", videoId);
    await db.$disconnect();
    process.exit(1);
  }

  console.log("=== Video ===\n", { id: video.id, title: video.title, status: video.status });
  console.log("\n=== postedPlatforms ===\n", JSON.stringify(video.postedPlatforms, null, 2));

  const postIds = parsePostedPlatforms(video.postedPlatforms);
  const ytPostId = postIds.get("YOUTUBE");
  console.log("\n=== Parsed YOUTUBE postId ===\n", ytPostId ?? "(none)");

  const insights = video.insights && typeof video.insights === "object" ? video.insights : {};
  console.log("\n=== insights (platform stats) ===\n", JSON.stringify(insights, null, 2));
  console.log("\ninsightsRefreshedAt:", video.insightsRefreshedAt ?? "(null)");

  await db.$disconnect();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
