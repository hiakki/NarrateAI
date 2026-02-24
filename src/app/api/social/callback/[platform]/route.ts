import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/social/encrypt";
import { createLogger } from "@/lib/logger";

const log = createLogger("OAuth");
const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
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
  log.log(`/me/accounts returned ${json.data?.length ?? 0} page(s)`, JSON.stringify(json));
  return json.data ?? [];
}

async function fetchBusinessPages(token: string): Promise<FBPage[]> {
  const bizRes = await fetch(
    `${GRAPH_API}/me/businesses?fields=id,name&access_token=${token}`,
  );
  const bizJson = await bizRes.json();
  const businesses = bizJson.data ?? [];
  log.log(`/me/businesses returned ${businesses.length} business(es):`, JSON.stringify(bizJson));

  const allPages: FBPage[] = [];

  for (const biz of businesses) {
    const pagesRes = await fetch(
      `${GRAPH_API}/${biz.id}/owned_pages?fields=id,name,access_token&limit=100&access_token=${token}`,
    );
    const pagesJson = await pagesRes.json();
    const pages: FBPage[] = pagesJson.data ?? [];
    log.log(`Business "${biz.name}" (${biz.id}) owns ${pages.length} page(s):`, JSON.stringify(pagesJson));

    if (pages.length === 0) {
      const clientRes = await fetch(
        `${GRAPH_API}/${biz.id}/client_pages?fields=id,name,access_token&limit=100&access_token=${token}`,
      );
      const clientJson = await clientRes.json();
      const clientPages: FBPage[] = clientJson.data ?? [];
      log.log(`Business "${biz.name}" client_pages: ${clientPages.length}`, JSON.stringify(clientJson));
      allPages.push(...clientPages);
    } else {
      allPages.push(...pages);
    }
  }

  return allPages;
}

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
  log.log("Granted permissions:", JSON.stringify(permData.data));

  if (state === "instagram") {
    const pagesRes = await fetch(
      `${GRAPH_API}/me/accounts?fields=id,name,instagram_business_account&access_token=${longToken}`,
    );
    const pagesJson = await pagesRes.json();
    const pages = pagesJson.data;
    log.log(`Instagram: /me/accounts returned ${pages?.length ?? 0} page(s):`, JSON.stringify(pagesJson));

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
