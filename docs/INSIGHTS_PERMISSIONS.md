# Why insights show 0 for FB/IG

After running `node scripts/test-insights-from-db.mjs` we see the real API responses. Typical causes:

## Facebook

1. **Video node (likes/comments)**  
   We use `comments.summary(total_count),likes.summary(total_count)` on the Video node. The old `reactions` field does not exist on all Video/Reel objects and has been replaced with `likes` where applicable.

2. **Views always 0**  
   Views come from `/{video-id}/video_insights?metric=total_video_views` or `fb_reels_total_plays`.  
   If you get:
   - `(#200) read_insights permission missing`  
   then the **Page access token** does not have the `read_insights` permission.  
   **Fix:** In Meta App Dashboard → App Review, add the `read_insights` permission for Pages. Then in your app, **disconnect and reconnect** the Facebook (Page) account in Dashboard → Channels so a new token is issued with `read_insights`.

## Instagram

1. **Likes/comments**  
   These come from the media node (`like_count`, `comments_count`) and work as long as the account is connected.

2. **Views always 0**  
   Views come from `/{media-id}/insights?metric=views`.  
   If you get:
   - `(#10) Application does not have permission for this action`  
   then the app does not have the **Instagram insights** permission.  
   **Fix:** In Meta App Dashboard, add the `instagram_manage_insights` (or `instagram_business_manage_insights`) permission and complete App Review if required. Then **disconnect and reconnect** Instagram in Dashboard → Channels.

## Verify yourself

```bash
node scripts/test-insights-from-db.mjs
```

Uses tokens from your DB (same as the app). Check the printed JSON for `error` in each response. Resolve permission errors by reconnecting the account with the right app permissions.
