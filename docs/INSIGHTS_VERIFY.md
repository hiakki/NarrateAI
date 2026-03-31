# Verifying FB/IG insights with real links

To fix "views always 0" we need to see the **exact JSON** returned by Meta’s APIs. Use one of the two options below.

## Test links

- **Facebook:** https://www.facebook.com/reel/769423079574206 (expect 7 views, 1 like)
- **Instagram:** https://www.instagram.com/reels/DVQO3ahiL-L/ (expect 102 views, 2 interactions)

---

## Option A: Use the app (recommended)

Uses your already-connected FB/IG accounts (no copy/paste of tokens).

1. Start the app and log in.
2. Ensure Facebook and Instagram are connected under **Channels**.
3. Open in the browser (same origin so cookies are sent):

   **http://localhost:3000/api/insights/test-responses**

4. You’ll get JSON with:
   - `facebook.videoNode` – video node (reactions, comments)
   - `facebook.videoInsightsTotalViews` – `video_insights?metric=total_video_views`
   - `facebook.videoInsightsReelsPlays` – `video_insights?metric=fb_reels_total_plays`
   - `instagram.mediaList` – list of media (we find the one for shortcode `DVQO3ahiL-L`)
   - `instagram.mediaNode` – that media’s like_count, comments_count
   - `instagram.mediaInsights` – that media’s `insights?metric=views`

5. If any of these contain `error`, note the message and fix (permissions, metric name, or parsing).
6. If there is no error, check the structure of `data[0].values` or `data[0].total_value` and ensure the code in `src/lib/social/facebook.ts` and `src/lib/social/instagram.ts` reads the view count from the same path.

---

## Option B: Standalone script with tokens in .env

If you prefer to run the same requests from the command line:

1. Add to `.env` (temporarily):

   - `FB_PAGE_ACCESS_TOKEN` – Page access token with `read_insights` (e.g. from [Graph API Explorer](https://developers.facebook.com/tools/explorer/), select your Page, add permission `read_insights`, copy token).
   - `IG_ACCESS_TOKEN` – Instagram (user/business) access token.
   - `IG_USER_ID` – Instagram Business Account ID (numeric). You can get it from your app after connecting IG (e.g. from Channels or from the test-responses response’s media list URL).

2. Run:

   ```bash
   node scripts/test-insights-api.mjs
   ```

3. The script prints the raw response bodies for the same endpoints. Use them to confirm the response shape and fix parsing if needed.

---

## What to check in the responses

- **Facebook `video_insights`:**  
  - Either `data[0].values[0].value` or `data[0].total_value.value` should be the number (e.g. 7).  
  - If you get `error` (e.g. invalid parameter), try the other metric (`total_video_views` vs `fb_reels_total_plays`).

- **Instagram media `insights`:**  
  - Same idea: `data[0].values[0].value` or `data[0].total_value.value` for views.  
  - If `views` is not supported for your token/app, the API may return an error or empty `data`; in that case we’d need a different metric or permission.

Once the real responses are confirmed, the parsing in `facebook.ts` and `instagram.ts` can be aligned with the actual structure.
