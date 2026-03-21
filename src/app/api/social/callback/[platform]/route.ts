import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/social/encrypt";
import { createLogger } from "@/lib/logger";

const log = createLogger("OAuth");

function getAppUrl(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const fromHeaders = `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3000"
    ? process.env.NEXT_PUBLIC_APP_URL
    : fromHeaders;
}
const GRAPH_API = "https://graph.facebook.com/v21.0";

interface FBPage {
  id: string;
  name: string;
  access_token: string;
}

async function fetchDirectPages(token: string): Promise<FBPage[]> {
  const res = await fetch(
    `${GRAPH_API}/me/accounts?fields=id,name,access_token&limit=100&access_token=${token}`,
  );
  const json = await res.json();
  log.log(`/me/accounts returned ${json.data?.length ?? 0} page(s)`);
  log.debug("/me/accounts payload:", JSON.stringify(json));
  return json.data ?? [];
}

async function fetchBusinessPages(token: string): Promise<FBPage[]> {
  const bizRes = await fetch(
    `${GRAPH_API}/me/businesses?fields=id,name&access_token=${token}`,
  );
  const bizJson = await bizRes.json();
  const businesses = bizJson.data ?? [];
  log.log(`/me/businesses returned ${businesses.length} business(es)`);
  log.debug("/me/businesses payload:", JSON.stringify(bizJson));

  const allPages: FBPage[] = [];

  for (const biz of businesses) {
    const pagesRes = await fetch(
      `${GRAPH_API}/${biz.id}/owned_pages?fields=id,name,access_token&limit=100&access_token=${token}`,
    );
    const pagesJson = await pagesRes.json();
    const pages: FBPage[] = pagesJson.data ?? [];
    log.log(`Business "${biz.name}" (${biz.id}) owns ${pages.length} page(s)`);

    if (pages.length === 0) {
      const clientRes = await fetch(
        `${GRAPH_API}/${biz.id}/client_pages?fields=id,name,access_token&limit=100&access_token=${token}`,
      );
      const clientJson = await clientRes.json();
      const clientPages: FBPage[] = clientJson.data ?? [];
      log.log(`Business "${biz.name}" client_pages: ${clientPages.length}`);
      allPages.push(...clientPages);
    } else {
      allPages.push(...pages);
    }
  }

  return allPages;
}

async function handleMetaCallback(code: string, state: string, userId: string, appUrl: string) {
  const appId = process.env.FACEBOOK_APP_ID!;
  const appSecret = process.env.FACEBOOK_APP_SECRET!;

  const tokenRes = await fetch(
    `${GRAPH_API}/oauth/access_token?` +
      new URLSearchParams({
        client_id: appId,
        client_secret: appSecret,
        redirect_uri: `${appUrl}/api/social/callback/meta`,
        code,
      }),
  );

  if (!tokenRes.ok) {
    const errBody = await tokenRes.text();
    log.error("Token exchange failed:", tokenRes.status, errBody);
    throw new Error("Failed to exchange code for token");
  }
  const { access_token: shortToken } = await tokenRes.json();
  log.log(`Meta token exchange OK (state=${state})`);

  const longTokenRes = await fetch(
    `${GRAPH_API}/oauth/access_token?` +
      new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortToken,
      }),
  );

  if (!longTokenRes.ok) {
    const errBody = await longTokenRes.text();
    log.error("Long-lived token exchange failed:", longTokenRes.status, errBody);
    throw new Error("Failed to get long-lived token");
  }
  const { access_token: longToken, expires_in } = await longTokenRes.json();
  log.log(`Long-lived token OK, expires_in=${expires_in}`);
  const tokenExpiry = expires_in
    ? new Date(Date.now() + expires_in * 1000)
    : null;

  const meRes = await fetch(`${GRAPH_API}/me?fields=id,name&access_token=${longToken}`);
  const meData = await meRes.json();
  log.log(`Authenticated as: ${meData.name} (${meData.id})`);

  const permRes = await fetch(`${GRAPH_API}/me/permissions?access_token=${longToken}`);
  const permData = await permRes.json();
  const perms = (permData.data ?? []).filter((p: { status: string }) => p.status === "granted").map((p: { permission: string }) => p.permission);
  log.log(`Granted ${perms.length} permissions: ${perms.join(", ")}`);

  if (state === "instagram") {
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${longToken}`,
    );
    const pagesJson = await pagesRes.json();
    const pages = pagesJson.data;
    log.log(`Instagram: /me/accounts returned ${pages?.length ?? 0} page(s)`);

    for (const page of pages ?? []) {
      if (!page.instagram_business_account?.id) continue;

      const igId = page.instagram_business_account.id;
      const pageToken = page.access_token;
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
          refreshTokenEnc: encrypt(pageToken),
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
          refreshTokenEnc: encrypt(pageToken),
          username: igProfile.username,
          profileUrl: `https://instagram.com/${igProfile.username}`,
          tokenExpiresAt: tokenExpiry,
          pageId: page.id,
          pageName: page.name,
        },
      });
    }
  } else {
    let pages = await fetchDirectPages(longToken);

    if (pages.length === 0) {
      log.log("No direct pages found, checking Business Portfolios...");
      pages = await fetchBusinessPages(longToken);
    }

    if (pages.length === 0) {
      log.warn("No Facebook Pages found via /me/accounts or Business Portfolio.");
    }

    for (const page of pages) {
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
          refreshTokenEnc: encrypt(longToken),
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
          refreshTokenEnc: encrypt(longToken),
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

async function handleYouTubeCallback(code: string, userId: string, appUrl: string): Promise<{ channelRequired?: boolean } | void> {
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
      redirect_uri: `${appUrl}/api/social/callback/youtube`,
      grant_type: "authorization_code",
    }),
  });

  if (!tokenRes.ok) throw new Error("Failed to exchange YouTube code");
  const tokens = await tokenRes.json();

  const apiKey = process.env.GOOGLE_API_KEY ?? process.env.YOUTUBE_API_KEY ?? "";
  const channelsUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true${apiKey ? `&key=${encodeURIComponent(apiKey)}` : ""}`;
  const channelRes = await fetch(channelsUrl, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  const channelData = await channelRes.json();
  const channel = channelData.items?.[0];
  const errorReason = channelData.error?.errors?.[0]?.reason;

  if (!channelRes.ok || channelData.error) {
    log.warn(
      "YouTube channels.list failed:",
      channelRes.status,
      channelData.error?.message ?? "",
      errorReason ? `(reason: ${errorReason})` : "",
    );
  }

  const displayName: string | null = channel?.snippet?.title ?? null;
  const channelId: string = channel?.id ?? "unknown";

  const tokenExpiry = tokens.expires_in
    ? new Date(Date.now() + tokens.expires_in * 1000)
    : null;

  if (channelId === "unknown") {
    const existing = await db.socialAccount.findFirst({
      where: { userId, platform: "YOUTUBE" },
      select: { id: true, platformUserId: true },
    });
    if (existing) {
      await db.socialAccount.update({
        where: { id: existing.id },
        data: {
          accessTokenEnc: encrypt(tokens.access_token),
          refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : null,
          username: displayName,
          tokenExpiresAt: tokenExpiry,
        },
      });
      return errorReason === "youtubeSignupRequired" ? { channelRequired: true } : undefined;
    }
    return errorReason === "youtubeSignupRequired" ? { channelRequired: true } : undefined;
  }

  await db.socialAccount.upsert({
    where: {
      userId_platform_platformUserId: {
        userId,
        platform: "YOUTUBE",
        platformUserId: channelId,
      },
    },
    update: {
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : undefined,
      username: displayName,
      tokenExpiresAt: tokenExpiry,
    },
    create: {
      userId,
      platform: "YOUTUBE",
      platformUserId: channelId,
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token
        ? encrypt(tokens.refresh_token)
        : null,
      username: displayName,
      profileUrl: channelId !== "unknown" ? `https://youtube.com/channel/${channelId}` : null,
      tokenExpiresAt: tokenExpiry,
    },
  });

  return channelId === "unknown" && errorReason === "youtubeSignupRequired" ? { channelRequired: true } : undefined;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const session = await auth();
    const appUrl = getAppUrl(req);
    if (!session?.user) {
      return NextResponse.redirect(`${appUrl}/login`);
    }

    const { platform } = await params;
    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    const error = url.searchParams.get("error");

    if (error) {
      log.error(`OAuth error for ${platform}: ${error}`);
      return NextResponse.redirect(
        `${appUrl}/dashboard/channels?error=${encodeURIComponent(error)}`,
      );
    }

    if (!code) {
      return NextResponse.redirect(
        `${appUrl}/dashboard/channels?error=no_code`,
      );
    }

    let youtubeError: string | undefined;
    switch (platform) {
      case "meta":
        await handleMetaCallback(code, state, session.user.id, appUrl);
        break;
      case "youtube": {
        const result = await handleYouTubeCallback(code, session.user.id, appUrl);
        if (result?.channelRequired) youtubeError = "channel_required";
        break;
      }
      default:
        return NextResponse.redirect(
          `${appUrl}/dashboard/channels?error=unknown_platform`,
        );
    }

    const base = `${appUrl}/dashboard/channels?connected=${platform === "meta" ? state : platform}`;
    const redirectUrl = youtubeError ? `${base}&youtube_error=${youtubeError}` : base;
    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    log.error("Social callback error:", error instanceof Error ? error.message : error);
    return NextResponse.redirect(
      `${getAppUrl(req)}/dashboard/channels?error=connection_failed`,
    );
  }
}
