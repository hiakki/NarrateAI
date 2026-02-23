import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/social/encrypt";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const GRAPH_API = "https://graph.facebook.com/v21.0";

async function handleMetaCallback(code: string, state: string, userId: string) {
  const appId = process.env.FACEBOOK_APP_ID!;
  const appSecret = process.env.FACEBOOK_APP_SECRET!;

  const tokenRes = await fetch(
    `${GRAPH_API}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: `${APP_URL()}/api/social/callback/meta`,
        code,
      }),
  );

  if (!tokenRes.ok) throw new Error("Failed to exchange code for token");
  const { access_token: shortToken } = await tokenRes.json();

  const longTokenRes = await fetch(
    `${GRAPH_API}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      }),
  );

  if (!longTokenRes.ok) throw new Error("Failed to get long-lived token");
  const { access_token: longToken, expires_in } = await longTokenRes.json();
  const tokenExpiry = expires_in
    ? new Date(Date.now() + expires_in * 1000)
    : null;

  if (state === "instagram") {
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?fields=id,name,instagram_business_account&access_token=${longToken}`,
    );
    const { data: pages } = await pagesRes.json();

    for (const page of pages ?? []) {
      if (!page.instagram_business_account?.id) continue;

      const igId = page.instagram_business_account.id;
      const igRes = await fetch(
        `${GRAPH_API}/${igId}?fields=username,profile_picture_url&access_token=${longToken}`,
      );
      const igProfile = await igRes.json();

      await db.socialAccount.upsert({
        where: {
          userId_platform_platformUserId: {
            userId,
            platform: "INSTAGRAM",
            platformUserId: igId,
          },
        },
        update: {
          accessTokenEnc: encrypt(longToken),
          username: igProfile.username,
          tokenExpiresAt: tokenExpiry,
          pageId: page.id,
          pageName: page.name,
        },
        create: {
          userId,
          platform: "INSTAGRAM",
          platformUserId: igId,
          accessTokenEnc: encrypt(longToken),
          username: igProfile.username,
          profileUrl: `https://instagram.com/${igProfile.username}`,
          tokenExpiresAt: tokenExpiry,
          pageId: page.id,
          pageName: page.name,
        },
      });
    }
  } else {
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?fields=id,name,access_token&access_token=${longToken}`,
    );
    const { data: pages } = await pagesRes.json();

    for (const page of pages ?? []) {
      await db.socialAccount.upsert({
        where: {
          userId_platform_platformUserId: {
            userId,
            platform: "FACEBOOK",
            platformUserId: page.id,
          },
        },
        update: {
          accessTokenEnc: encrypt(page.access_token),
          username: page.name,
          pageId: page.id,
          pageName: page.name,
          tokenExpiresAt: tokenExpiry,
        },
        create: {
          userId,
          platform: "FACEBOOK",
          platformUserId: page.id,
          accessTokenEnc: encrypt(page.access_token),
          username: page.name,
          pageId: page.id,
          pageName: page.name,
          profileUrl: `https://facebook.com/${page.id}`,
          tokenExpiresAt: tokenExpiry,
        },
      });
    }
  }
}

async function handleYouTubeCallback(code: string, userId: string) {
  const clientId =
    process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID!;
  const clientSecret =
    process.env.YOUTUBE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET!;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: `${APP_URL()}/api/social/callback/youtube`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) throw new Error("Failed to exchange YouTube code");
  const tokens = await tokenRes.json();

  const channelRes = await fetch(
    `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true`,
    { headers: { Authorization: `Bearer ${tokens.access_token}` } },
  );

  const channelData = await channelRes.json();
  const channel = channelData.items?.[0];

  const tokenExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  await db.socialAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: "YOUTUBE",
        platformUserId: channel?.id ?? "unknown",
      },
    },
    update: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      username: channel?.snippet?.title,
      tokenExpiresAt: tokenExpiry,
    },
    create: {
      userId,
      platform: "YOUTUBE",
      platformUserId: channel?.id ?? "unknown",
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : null,
      username: channel?.snippet?.title,
      profileUrl: channel
        ? `https://youtube.com/channel/${channel.id}`
        : null,
      tokenExpiresAt: tokenExpiry,
    },
  });
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.redirect(`${APP_URL()}/login`);
    }

    const { platform } = await params;
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");

    if (error) {
      console.error(`OAuth error for ${platform}:`, error);
      return NextResponse.redirect(
        `${APP_URL()}/dashboard/channels?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code) {
      return NextResponse.redirect(
        `${APP_URL()}/dashboard/channels?error=no_code`,
      );
    }

    switch (platform) {
      case "meta":
        await handleMetaCallback(code, state, session.user.id);
        break;
      case "youtube":
        await handleYouTubeCallback(code, session.user.id);
        break;
      default:
        return NextResponse.redirect(
          `${APP_URL()}/dashboard/channels?error=unknown_platform`,
        );
    }

    return NextResponse.redirect(
      `${APP_URL()}/dashboard/channels?connected=${platform === "meta" ? state : platform}`,
    );
  } catch (error) {
    console.error("Social callback error:", error);
    return NextResponse.redirect(
      `${APP_URL()}/dashboard/channels?error=connection_failed`,
    );
  }
}
