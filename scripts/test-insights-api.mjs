#!/usr/bin/env node
/**
 * Verify Meta (Facebook + Instagram) insights API responses against real links.
 * Run: node scripts/test-insights-api.mjs
 * Requires in .env or environment:
 *   - FB_PAGE_ACCESS_TOKEN  (Page access token with read_insights)
 *   - IG_ACCESS_TOKEN       (Instagram user/business token)
 *   - IG_USER_ID            (Instagram business user id, numeric)
 *
 * Test links:
 *   FB:  https://www.facebook.com/reel/769423079574206  (expect 7 views, 1 like)
 *   IG:  https://www.instagram.com/reels/DVQO3ahiL-L/   (expect 102 views, 2 interactions)
 */

import "dotenv/config";

const GRAPH = "https://graph.facebook.com/v21.0";

async function main() {
  const fbToken = process.env.FB_PAGE_ACCESS_TOKEN;
  const igToken = process.env.IG_ACCESS_TOKEN;
  const igUserId = process.env.IG_USER_ID;

  console.log("=== Facebook Reel: 769423079574206 ===\n");

  if (fbToken) {
    // 1) Video node (reactions, comments)
    const videoUrl = `${GRAPH}/769423079574206?fields=reactions.summary(total_count),comments.summary(total_count)&access_token=${encodeURIComponent(fbToken)}`;
    console.log("1) GET video node (reactions, comments):");
    try {
      const r = await fetch(videoUrl);
      const text = await r.text();
      console.log("   Status:", r.status, r.statusText);
      console.log("   Body:", text);
      try {
        const j = JSON.parse(text);
        if (j.error) console.log("   ERROR:", j.error.message);
      } catch (_) {}
    } catch (e) {
      console.log("   Fetch error:", e.message);
    }

    // 2) Video insights - total_video_views
    console.log("\n2) GET video_insights?metric=total_video_views&period=lifetime:");
    try {
      const insightsUrl = `${GRAPH}/769423079574206/video_insights?metric=total_video_views&period=lifetime&access_token=${encodeURIComponent(fbToken)}`;
      const r = await fetch(insightsUrl);
      const text = await r.text();
      console.log("   Status:", r.status, r.statusText);
      console.log("   Body:", text);
      try {
        const j = JSON.parse(text);
        if (j.error) console.log("   ERROR:", j.error.message);
        if (j.data?.[0]) {
          const v = j.data[0];
          console.log("   Parsed: name=%s values=%j total_value=%j", v.name, v.values, v.total_value);
        }
      } catch (_) {}
    } catch (e) {
      console.log("   Fetch error:", e.message);
    }

    // 3) Video insights - fb_reels_total_plays (Reels metric)
    console.log("\n3) GET video_insights?metric=fb_reels_total_plays&period=lifetime:");
    try {
      const insightsUrl = `${GRAPH}/769423079574206/video_insights?metric=fb_reels_total_plays&period=lifetime&access_token=${encodeURIComponent(fbToken)}`;
      const r = await fetch(insightsUrl);
      const text = await r.text();
      console.log("   Status:", r.status, r.statusText);
      console.log("   Body:", text);
      try {
        const j = JSON.parse(text);
        if (j.error) console.log("   ERROR:", j.error.message);
        if (j.data?.[0]) {
          const v = j.data[0];
          console.log("   Parsed: name=%s values=%j total_value=%j", v.name, v.values, v.total_value);
        }
      } catch (_) {}
    } catch (e) {
      console.log("   Fetch error:", e.message);
    }
  } else {
    console.log("Set FB_PAGE_ACCESS_TOKEN in .env to test Facebook.");
  }

  console.log("\n=== Instagram Reel: shortcode DVQO3ahiL-L ===\n");

  if (igToken && igUserId) {
    // 1) List media to find media ID for shortcode
    console.log("1) GET /" + igUserId + "/media?fields=id,permalink&limit=50:");
    try {
      const mediaListUrl = `${GRAPH}/${igUserId}/media?fields=id,permalink&limit=50&access_token=${encodeURIComponent(igToken)}`;
      const r = await fetch(mediaListUrl);
      const text = await r.text();
      console.log("   Status:", r.status, r.statusText);
      try {
        const j = JSON.parse(text);
        if (j.error) {
          console.log("   ERROR:", j.error.message);
        } else {
          const list = j.data || [];
          console.log("   Media count:", list.length);
          const shortcode = "DVQO3ahiL-L";
          const found = list.find((m) => (m.permalink || "").includes(shortcode) || (m.permalink || "").toLowerCase().includes(shortcode.toLowerCase()));
          if (found) {
            console.log("   Found media for shortcode:", found.id, found.permalink);
            const mediaId = found.id;

            // 2) Media node (like_count, comments_count)
            console.log("\n2) GET /" + mediaId + "?fields=like_count,comments_count:");
            const mediaUrl = `${GRAPH}/${mediaId}?fields=like_count,comments_count&access_token=${encodeURIComponent(igToken)}`;
            const r2 = await fetch(mediaUrl);
            const text2 = await r2.text();
            console.log("   Status:", r2.status, r2.statusText);
            console.log("   Body:", text2);

            // 3) Media insights (views)
            console.log("\n3) GET /" + mediaId + "/insights?metric=views&period=lifetime:");
            const insightsUrl = `${GRAPH}/${mediaId}/insights?metric=views&period=lifetime&access_token=${encodeURIComponent(igToken)}`;
            const r3 = await fetch(insightsUrl);
            const text3 = await r3.text();
            console.log("   Status:", r3.status, r3.statusText);
            console.log("   Body:", text3);
            try {
              const j3 = JSON.parse(text3);
              if (j3.error) console.log("   ERROR:", j3.error.message);
              if (j3.data?.[0]) {
                const v = j3.data[0];
                console.log("   Parsed: name=%s values=%j total_value=%j", v.name, v.values, v.total_value);
              }
            } catch (_) {}
          } else {
            console.log("   Shortcode " + shortcode + " not found in first 50 media. First permalink:", list[0]?.permalink);
          }
        }
      } catch (_) {
        console.log("   Body (raw):", text.slice(0, 500));
      }
    } catch (e) {
      console.log("   Fetch error:", e.message);
    }
  } else {
    console.log("Set IG_ACCESS_TOKEN and IG_USER_ID in .env to test Instagram.");
    console.log("(IG_USER_ID is the numeric Instagram Business Account ID from your app/Channels.)");
  }

  console.log("\n=== Done ===");
}

main();
