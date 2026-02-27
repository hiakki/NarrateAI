import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";

const APP_URL = () => process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

function buildMetaOAuthUrl(extraScopes: string[]): string {
  const appId = process.env.FACEBOOK_APP_ID;
  if (!appId) throw new Error("FACEBOOK_APP_ID not configured");

  const scopes = [
    "public_profile",
    ...extraScopes,
  ].join(",");

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: `${APP_URL()}/api/social/callback/meta`,
    scope: scopes,
    response_type: "code",
    auth_type: "rerequest",
    state: extraScopes.includes("instagram_basic") ? "instagram" : "facebook",
  });

  return `https://www.facebook.com/v21.0/dialog/oauth?${params}`;
}

function buildYouTubeOAuthUrl(): string {
  const clientId = process.env.YOUTUBE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("YOUTUBE_CLIENT_ID or GOOGLE_CLIENT_ID not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: `${APP_URL()}/api/social/callback/youtube`,
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
  _req: NextRequest,
  { params }: { params: Promise<{ platform: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { platform } = await params;

    let redirectUrl: string;

    switch (platform) {
      case "instagram":
        redirectUrl = buildMetaOAuthUrl([
          "instagram_basic",
          "instagram_content_publish",
          "instagram_manage_comments",
          "pages_show_list",
          "pages_read_engagement",
        ]);
        break;

      case "facebook":
        redirectUrl = buildMetaOAuthUrl([
          "pages_show_list",
          "pages_manage_posts",
          "pages_manage_engagement",
          "pages_read_engagement",
          "business_management",
        ]);
        break;

      case "youtube":
        redirectUrl = buildYouTubeOAuthUrl();
        break;

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
