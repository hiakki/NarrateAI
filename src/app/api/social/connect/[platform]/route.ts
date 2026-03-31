import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

function getAppUrl(req: NextRequest): string {
  // Derive from request headers so it works across dev/tunnel/production
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  const fromHeaders = `${proto}://${host}`;
  return process.env.NEXT_PUBLIC_APP_URL && process.env.NEXT_PUBLIC_APP_URL !== "http://localhost:3000"
    ? process.env.NEXT_PUBLIC_APP_URL
    : fromHeaders;
}

function buildMetaOAuthUrl(appUrl: string, extraScopes: string[]): string {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) throw new Error("FACEBOOK_APP_ID not configured");

  const scopes = [
    "public_profile",
    ...extraScopes,
  ].join(",");

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${appUrl}/api/social/callback/meta`,
    scope: scopes,
    response_type: "code",
    auth_type: "rerequest",
    state: extraScopes.includes("instagram_basic") ? "instagram" : "facebook",
  });

  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

function buildYouTubeOAuthUrl(appUrl: string): string {
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("YOUTUBE_CLIENT_ID or GOOGLE_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${appUrl}/api/social/callback/youtube`,
    scope: [
      "https://www.googleapis.com/auth/youtube.upload",
      "https://www.googleapis.com/auth/youtube.readonly",
      "https://www.googleapis.com/auth/youtube.force-ssl",
    ].join(" "),
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { platform } = await params;
    const appUrl = getAppUrl(req);

    let redirectUrl: string;

    switch (platform) {
      case "instagram":
        redirectUrl = buildMetaOAuthUrl(appUrl, [
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_comments",
          "instagram_manage_insights",
          "instagram_manage_contents",
          "pages_show_list",
          "pages_read_engagement",
        ]);
        break;

      case "facebook":
        redirectUrl = buildMetaOAuthUrl(appUrl, [
          "pages_show_list",
          "pages_manage_posts",
          "pages_manage_engagement",
          "pages_read_engagement",
          "read_insights",
          "business_management",
        ]);
        break;

      case "youtube":
        redirectUrl = buildYouTubeOAuthUrl(appUrl);
        break;

      case "sharechat":
      case "moj":
        return NextResponse.json(
          {
            error: `${platform === "sharechat" ? "ShareChat" : "Moj"} does not offer a public developer API yet. Contact the platform for partner/creator API access.`,
          },
          { status: 501 },
        );

      default:
        return NextResponse.json(
          { error: `Unsupported platform: ${platform}` },
          { status: 400 },
        );
    }

    return NextResponse.redirect(redirectUrl);
  } catch (error) {
    console.error("Social connect error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to initiate connection" },
      { status: 500 },
    );
  }
}
