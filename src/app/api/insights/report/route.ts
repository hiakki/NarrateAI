import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NICHES } from "@/config/niches";

const VIEW_PLATFORMS = ["YOUTUBE", "INSTAGRAM", "FACEBOOK"] as const;
const LOW_VIEWS_PER_VIDEO = 20;

type VideoInsightsMap = Record<string, { views?: number; likes?: number; comments?: number; reactions?: number }>;

function sumInsights(insights: VideoInsightsMap | null): { views: number; likes: number; comments: number; reactions: number } {
  let views = 0, likes = 0, comments = 0, reactions = 0;
  if (!insights || typeof insights !== "object") return { views, likes, comments, reactions };
  for (const platform of VIEW_PLATFORMS) {
    const p = (insights as Record<string, unknown>)[platform];
    if (p && typeof p === "object" && !Array.isArray(p)) {
      const o = p as { views?: number; likes?: number; comments?: number; reactions?: number };
      views += Number(o.views) || 0;
      likes += Number(o.likes) || 0;
      comments += Number(o.comments) || 0;
      reactions += Number(o.reactions) || 0;
    }
  }
  return { views, likes, comments, reactions };
}

export type ReportSuggestion = {
  id: string;
  type: "add_platform" | "add_platforms" | "try_multi_platform" | "switch_niche" | "reenable" | "deactivate_and_create";
  title: string;
  description: string;
  automationId?: string;
  automationName?: string;
  action: "update" | "create" | "update_and_create";
  payload: Record<string, unknown>;
  /** When action is update_and_create: pause this automation then create a new one. */
  updatePayload?: Record<string, unknown>;
  createPayload?: Record<string, unknown>;
};

export type InsightsReport = {
  scorecard: {
    totalViews: number;
    totalInteractions: number;
    totalVideos: number;
    automationsCount: number;
    viewsPerVideo: number;
    interactionsPerVideo: number;
    /** 0–100 score for "views potential" (multi-platform, active automations, etc.). Shown in suggestions section. */
    scorePercent: number;
    lastRefreshedAt: string | null;
    byAutomation: Array<{
      automationId: string;
      name: string;
      niche: string;
      artStyle: string;
      tone: string;
      language: string;
      postTime: string;
      timezone: string;
      targetPlatforms: string[];
      enabled: boolean;
      totalViews: number;
      totalInteractions: number;
      videoCount: number;
      viewsPerVideo: number;
      interactionsPerVideo: number;
      lastRefreshedAt: string | null;
    }>;
  };
  suggestions: ReportSuggestion[];
};

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const userId = session.user.id;

    const automations = await db.automation.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        niche: true,
        artStyle: true,
        targetPlatforms: true,
        enabled: true,
        seriesId: true,
        frequency: true,
        postTime: true,
        timezone: true,
        language: true,
        tone: true,
        duration: true,
        voiceId: true,
        characterId: true,
      },
      orderBy: { createdAt: "desc" },
    });

    const videos = await db.video.findMany({
      where: { series: { userId }, status: "POSTED" },
      select: { id: true, seriesId: true, insights: true, insightsRefreshedAt: true },
    });

    const byAutomation: InsightsReport["scorecard"]["byAutomation"] = [];
    let totalViews = 0, totalInteractions = 0;
    let lastRefreshedAt: Date | null = null;

    for (const auto of automations) {
      const platforms = Array.isArray(auto.targetPlatforms) ? auto.targetPlatforms as string[] : [];
      const autoVideos = auto.seriesId ? videos.filter((v) => v.seriesId === auto.seriesId) : [];
      let av = 0, al = 0, ac = 0, ar = 0;
      let aRefreshed: Date | null = null;
      for (const v of autoVideos) {
        const s = sumInsights(v.insights as VideoInsightsMap);
        av += s.views;
        al += s.likes;
        ac += s.comments;
        ar += s.reactions;
        if (v.insightsRefreshedAt && (!aRefreshed || v.insightsRefreshedAt > aRefreshed)) aRefreshed = v.insightsRefreshedAt;
      }
      const interactions = al + ac + ar;
      totalViews += av;
      totalInteractions += interactions;
      if (aRefreshed && (!lastRefreshedAt || aRefreshed > lastRefreshedAt)) lastRefreshedAt = aRefreshed;
      const viewsPerVideo = autoVideos.length > 0 ? av / autoVideos.length : 0;
      const interactionsPerVideo = autoVideos.length > 0 ? interactions / autoVideos.length : 0;
      byAutomation.push({
        automationId: auto.id,
        name: auto.name,
        niche: auto.niche,
        artStyle: auto.artStyle ?? "realistic",
        tone: auto.tone ?? "dramatic",
        language: auto.language ?? "en",
        postTime: auto.postTime ?? "09:00",
        timezone: auto.timezone ?? "UTC",
        targetPlatforms: platforms,
        enabled: auto.enabled,
        totalViews: av,
        totalInteractions: interactions,
        videoCount: autoVideos.length,
        viewsPerVideo: Math.round(viewsPerVideo * 10) / 10,
        interactionsPerVideo: Math.round(interactionsPerVideo * 10) / 10,
        lastRefreshedAt: aRefreshed?.toISOString() ?? null,
      });
    }

    const totalVideos = videos.length;
    const viewsPerVideoGlobal = totalVideos > 0 ? totalViews / totalVideos : 0;
    const interactionsPerVideoGlobal = totalVideos > 0 ? totalInteractions / totalVideos : 0;

    const scorePercent = computeScorePercent(byAutomation, automations.length, totalVideos, totalViews);

    const scorecard: InsightsReport["scorecard"] = {
      totalViews,
      totalInteractions,
      totalVideos,
      automationsCount: automations.length,
      viewsPerVideo: Math.round(viewsPerVideoGlobal * 10) / 10,
      interactionsPerVideo: Math.round(interactionsPerVideoGlobal * 10) / 10,
      scorePercent,
      lastRefreshedAt: lastRefreshedAt?.toISOString() ?? null,
      byAutomation,
    };

    const suggestions = buildSuggestions(automations, byAutomation);

    return NextResponse.json({
      data: { scorecard, suggestions } as InsightsReport,
    });
  } catch (error) {
    console.error("Insights report error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load report" },
      { status: 500 },
    );
  }
}

function buildSuggestions(
  automations: Array<{
    id: string;
    name: string;
    niche: string;
    artStyle: string;
    targetPlatforms: unknown;
    enabled: boolean;
    seriesId: string | null;
    frequency: string;
    postTime: string;
    timezone: string;
    language: string;
    tone: string;
    duration: number;
    voiceId: string | null;
    characterId: string | null;
  }>,
  byAutomation: InsightsReport["scorecard"]["byAutomation"],
): ReportSuggestion[] {
  const out: ReportSuggestion[] = [];
  const seen = new Set<string>();

  const platformList = [...VIEW_PLATFORMS];
  const firstAuto = automations[0];

  for (const row of byAutomation) {
    const auto = automations.find((a) => a.id === row.automationId);
    if (!auto) continue;
    const platforms = Array.isArray(auto.targetPlatforms) ? (auto.targetPlatforms as string[]) : [];

    if (!auto.enabled) {
      const id = `reenable-${auto.id}`;
      if (!seen.has(id)) {
        seen.add(id);
        out.push({
          id,
          type: "reenable",
          title: `Re-enable "${row.name}"`,
          description: "This automation is paused. Turn it back on to start generating and posting videos again.",
          automationId: auto.id,
          automationName: row.name,
          action: "update",
          payload: { enabled: true },
        });
      }
      continue;
    }

    if (platforms.length === 1 && platformList.includes(platforms[0] as typeof platformList[number])) {
      const nextPlatform = platformList.find((p) => !platforms.includes(p));
      if (nextPlatform) {
        const newPlatforms = [...platforms, nextPlatform];
        const id = `add-platform-${auto.id}-${nextPlatform}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push({
            id,
            type: "add_platform",
            title: `Add ${platformLabel(nextPlatform)} to "${row.name}"`,
            description: "Posting to more platforms usually increases total views. One click adds this platform to the automation.",
            automationId: auto.id,
            automationName: row.name,
            action: "update",
            payload: { targetPlatforms: newPlatforms },
          });
        }
      }
      if (row.videoCount >= 1 && row.viewsPerVideo < LOW_VIEWS_PER_VIDEO) {
        const id = `deactivate-and-create-${auto.id}`;
        if (!seen.has(id)) {
          seen.add(id);
          const nicheConfig = NICHES.find((n) => n.id === auto.niche) ?? NICHES[0];
          out.push({
            id,
            type: "deactivate_and_create",
            title: `Pause "${row.name}" and create multi-platform automation`,
            description: "This automation has few views and only one platform. Pause it and start a new one that posts to YouTube, Instagram, and Facebook for more reach.",
            automationId: auto.id,
            automationName: row.name,
            action: "update_and_create",
            payload: {},
            updatePayload: { enabled: false },
            createPayload: {
              name: `Multi-platform ${nicheConfig.name}`,
              niche: nicheConfig.id,
              artStyle: nicheConfig.defaultArtStyle,
              targetPlatforms: [...VIEW_PLATFORMS],
              frequency: auto.frequency || "daily",
              postTime: auto.postTime || "09:00",
              timezone: auto.timezone || "UTC",
              language: auto.language || "en",
              tone: nicheConfig.defaultTone,
              duration: auto.duration ?? 45,
              voiceId: auto.voiceId ?? undefined,
              characterId: auto.characterId ?? undefined,
              enabled: true,
              includeAiTags: true,
            },
          });
        }
      }
    }

    if (platforms.length === 2) {
      const nextPlatform = platformList.find((p) => !platforms.includes(p));
      if (nextPlatform) {
        const newPlatforms = [...platforms, nextPlatform];
        const id = `add-platforms-${auto.id}-${nextPlatform}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push({
            id,
            type: "add_platforms",
            title: `Add ${platformLabel(nextPlatform)} to "${row.name}" (YouTube + Instagram + Facebook)`,
            description: "Reach the maximum audience by posting to all three major platforms.",
            automationId: auto.id,
            automationName: row.name,
            action: "update",
            payload: { targetPlatforms: newPlatforms },
          });
        }
      }
    }

    if (
      row.videoCount > 0 &&
      row.viewsPerVideo < LOW_VIEWS_PER_VIDEO &&
      platforms.length < 3
    ) {
      const nextPlatform = platformList.find((p) => !platforms.includes(p));
      if (nextPlatform) {
        const newPlatforms = [...platforms, nextPlatform];
        const id = `low-views-add-${auto.id}`;
        if (!seen.has(id)) {
          seen.add(id);
          out.push({
            id,
            type: "add_platforms",
            title: `Get more views: add ${platformLabel(nextPlatform)} to "${row.name}"`,
            description: `This automation averages ${row.viewsPerVideo} views per video. Adding another platform can increase reach.`,
            automationId: auto.id,
            automationName: row.name,
            action: "update",
            payload: { targetPlatforms: newPlatforms },
          });
        }
      }
    }
  }

  const hasMultiPlatform = byAutomation.some(
    (r) => (Array.isArray(r.targetPlatforms) ? r.targetPlatforms.length : 0) >= 3,
  );
  if (!hasMultiPlatform && firstAuto && automations.some((a) => a.enabled)) {
    const id = "create-multi-platform";
    if (!seen.has(id)) {
      seen.add(id);
      const niche = firstAuto.niche || "science-facts";
      const nicheConfig = NICHES.find((n) => n.id === niche) ?? NICHES[0];
      out.push({
        id,
        type: "try_multi_platform",
        title: "Create a multi-platform automation",
        description: "New automation that posts to YouTube, Instagram, and Facebook for maximum views.",
        action: "create",
        payload: {
          name: `Multi-platform ${nicheConfig.name}`,
          niche: nicheConfig.id,
          artStyle: nicheConfig.defaultArtStyle,
          targetPlatforms: [...VIEW_PLATFORMS],
          frequency: firstAuto.frequency || "daily",
          postTime: firstAuto.postTime || "09:00",
          timezone: firstAuto.timezone || "UTC",
          language: firstAuto.language || "en",
          tone: nicheConfig.defaultTone,
          duration: firstAuto.duration ?? 45,
          voiceId: firstAuto.voiceId ?? undefined,
          characterId: firstAuto.characterId ?? undefined,
          enabled: true,
          includeAiTags: true,
        },
      });
    }
  }

  const lowViewAutomations = byAutomation.filter(
    (r) => r.enabled && r.videoCount >= 2 && r.viewsPerVideo < LOW_VIEWS_PER_VIDEO && r.targetPlatforms.length >= 2,
  );
  for (const row of lowViewAutomations) {
    const auto = automations.find((a) => a.id === row.automationId);
    if (!auto) continue;
    const altNiche = NICHES.find((n) => n.id !== auto.niche);
    if (!altNiche) continue;
    const id = `switch-niche-${auto.id}-${altNiche.id}`;
    if (!seen.has(id)) {
      seen.add(id);
      out.push({
        id,
        type: "switch_niche",
        title: `Try "${altNiche.name}" niche for "${row.name}"`,
        description: `This automation gets ${row.viewsPerVideo} views per video. Trying a different niche can sometimes improve performance.`,
        automationId: auto.id,
        automationName: row.name,
        action: "update",
        payload: { niche: altNiche.id },
      });
    }
  }

  return out;
}

type ByAutomationRow = InsightsReport["scorecard"]["byAutomation"][number];

function computeScorePercent(
  rows: ByAutomationRow[],
  autoCount: number,
  videoCount: number,
  views: number,
): number {
  if (autoCount === 0) return 0;
  let score = 0;
  const enabled = rows.filter((r) => r.enabled);
  const enabledCount = enabled.length;
  if (enabledCount === 0) return 0;
  const multiPlatform = enabled.filter((r) => r.targetPlatforms.length >= 3).length;
  score += Math.round((multiPlatform / enabledCount) * 40);
  const noSinglePlatform = enabled.every((r) => r.targetPlatforms.length >= 2);
  if (noSinglePlatform) score += 30;
  else score += Math.round((enabled.filter((r) => r.targetPlatforms.length >= 2).length / enabledCount) * 30);
  if (enabledCount === autoCount) score += 15;
  else score += Math.round((enabledCount / autoCount) * 15);
  if (videoCount > 0 && views > 0) score += 15;
  return Math.min(100, score);
}

function platformLabel(p: string): string {
  const map: Record<string, string> = {
    YOUTUBE: "YouTube",
    INSTAGRAM: "Instagram",
    FACEBOOK: "Facebook",
  };
  return map[p] ?? p;
}
