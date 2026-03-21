import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";
import { getCookieFilePath } from "@/lib/cookie-path";
import { discoverFbPageVideos, discoverIgReels, type ScrapedVideo } from "./browser-scraper";

const execFileAsync = promisify(execFile);
const log = createLogger("ClipDiscovery");

export type Platform = "youtube" | "facebook" | "instagram" | "tiktok" | "twitter" | "other";

export interface DiscoveredVideo {
  videoId: string;
  url: string;
  title: string;
  channelId: string;
  channelName: string;
  viewCount: number;
  publishedAt: string;
  durationSec: number;
  platform: Platform;
  source: "channel" | "trending" | "creative-commons" | "direct";
}

export interface DiscoveryResult {
  selected: DiscoveredVideo;
  candidates: Array<{ title: string; url: string; viewCount: number; platform: string; channelName: string; score?: number }>;
  totalConsidered: number;
}

// ── Niche → channel mapping ──────────────────────────────────────────────────
export type ClipNiche =
  | "viral-repost" | "entertainment" | "films" | "anime" | "serials"
  | "nature" | "science" | "sports" | "gaming"
  | "food" | "travel" | "news" | "education" | "motivation"
  | "comedy" | "music" | "auto";

export const CLIP_NICHES: Record<ClipNiche, { label: string; description: string; icon: string }> = {
  "viral-repost": { label: "Viral Repost (Non-Copyrighted)", description: "Creators who allow free reposting — MrBeast, Mark Rober, etc.", icon: "🔥" },
  films:         { label: "Films & Movies", description: "Movie scenes, trailers, iconic moments", icon: "🎬" },
  anime:         { label: "Anime", description: "Anime clips, fights, emotional scenes, AMVs", icon: "⚔️" },
  serials:       { label: "TV Serials & Shows", description: "TV show clips, drama scenes, sitcom moments", icon: "📺" },
  entertainment: { label: "Entertainment", description: "Stunts, challenges, pranks, viral moments", icon: "🎭" },
  nature:        { label: "Nature & Animals", description: "Wildlife, ocean, nature documentaries", icon: "🌿" },
  science:       { label: "Science & Tech", description: "Space, physics, engineering, experiments", icon: "🔬" },
  sports:        { label: "Sports & Fitness", description: "Highlights, extreme sports, athletics", icon: "⚽" },
  gaming:        { label: "Gaming", description: "Game clips, esports, speedruns", icon: "🎮" },
  food:          { label: "Food & Cooking", description: "Recipes, food challenges, street food", icon: "🍳" },
  travel:        { label: "Travel & Adventure", description: "Destinations, culture, exploration", icon: "✈️" },
  news:          { label: "News & Current Events", description: "Breaking news, analysis, documentaries", icon: "📰" },
  education:     { label: "Education", description: "Explainers, how-to, history, tutorials", icon: "📚" },
  motivation:    { label: "Motivation & Self-Help", description: "Speeches, success stories, productivity", icon: "💪" },
  comedy:        { label: "Comedy & Memes", description: "Stand-up, sketches, internet humor", icon: "😂" },
  music:         { label: "Music & Dance", description: "Performances, covers, dance trends", icon: "🎵" },
  auto:          { label: "Auto (All Niches)", description: "Mix from all trending content", icon: "🔄" },
};

// Viral compilation / repost-friendly creators (no overlap with entertainment niche)
const NON_COPYRIGHT_YT = [
  "https://www.youtube.com/@MarkRober",
  "https://www.youtube.com/@DailyDoseOfInternet",
  "https://www.youtube.com/@RyanTrahan",
  "https://www.youtube.com/@ZHCCrafts",
  "https://www.youtube.com/@SteveWillDoIt",
];

// YouTube handles — yt-dlp can scrape these directly (RSS feeds are dead)
const NICHE_YT_HANDLES: Record<ClipNiche, string[]> = {
  "viral-repost": [
    ...NON_COPYRIGHT_YT,
    "https://www.youtube.com/@ViralHog",
    "https://www.youtube.com/@PeopleAreAwesome",
  ],
  films: [
    "https://www.youtube.com/@MovieclipsTRAILERS",
    "https://www.youtube.com/@Movieclips",
    "https://www.youtube.com/@RottenTomatoesTrailers",
    "https://www.youtube.com/@ScreenCulture",
  ],
  anime: [
    "https://www.youtube.com/@Crunchyroll",
    "https://www.youtube.com/@Maboroshi",
    "https://www.youtube.com/@Funimation",
  ],
  serials: [
    "https://www.youtube.com/@netflix",
    "https://www.youtube.com/@PrimeVideoIN",
    "https://www.youtube.com/@HBO",
    "https://www.youtube.com/@DisneyPlusHotstar",
  ],
  entertainment: [
    "https://www.youtube.com/@MrBeast",
    "https://www.youtube.com/@dudeperfect",
    "https://www.youtube.com/@Airrack",
    "https://www.youtube.com/@BenAzelart",
    "https://www.youtube.com/@SSSniperWolf",
    "https://www.youtube.com/@prestonplayz",
    "https://www.youtube.com/@RedBull",
  ],
  nature: [
    "https://www.youtube.com/@NatGeo",
    "https://www.youtube.com/@BBCEarth",
    "https://www.youtube.com/@TheDodo",
  ],
  science: [
    "https://www.youtube.com/@veritasium",
    "https://www.youtube.com/@kurzgesagt",
    "https://www.youtube.com/@smartereveryday",
    "https://www.youtube.com/@NASA",
  ],
  sports: [
    "https://www.youtube.com/@ESPN",
    "https://www.youtube.com/@AdrenalineAddiction",
    "https://www.youtube.com/@HouseofHighlights",
  ],
  gaming: [
    "https://www.youtube.com/@GameGrumps",
    "https://www.youtube.com/@IGN",
  ],
  food: [
    "https://www.youtube.com/@BabishCulinaryUniverse",
    "https://www.youtube.com/@JoshuaWeissman",
  ],
  travel: [
    "https://www.youtube.com/@VICE",
    "https://www.youtube.com/@Insider",
  ],
  news: [
    "https://www.youtube.com/@Insider",
    "https://www.youtube.com/@VICE",
  ],
  education: [
    "https://www.youtube.com/@TEDEd",
    "https://www.youtube.com/@khanacademy",
    "https://www.youtube.com/@CGPGrey",
  ],
  motivation: [
    "https://www.youtube.com/@TEDEd",
    "https://www.youtube.com/@Goalcast",
  ],
  comedy: [
    "https://www.youtube.com/@failarmy",
    "https://www.youtube.com/@JustForLaughsGags",
    "https://www.youtube.com/@LADbible",
  ],
  music: [],
  auto: [],
};

const NICHE_FB_PAGES: Record<ClipNiche, string[]> = {
  "viral-repost": [
    "https://www.facebook.com/DailyDoseOfInternet/videos/",
    "https://www.facebook.com/ViralHog/videos/",
    "https://www.facebook.com/PeopleAreAwesome/videos/",
  ],
  films: [
    "https://www.facebook.com/UniversalPictures/videos/",
    "https://www.facebook.com/WarnerBrosPictures/videos/",
    "https://www.facebook.com/MarvelEntertainment/videos/",
    "https://www.facebook.com/SonyPictures/videos/",
  ],
  anime: [
    "https://www.facebook.com/Crunchyroll/videos/",
    "https://www.facebook.com/funimation/videos/",
  ],
  serials: [
    "https://www.facebook.com/netflix/videos/",
    "https://www.facebook.com/PrimeVideoIN/videos/",
    "https://www.facebook.com/HBO/videos/",
    "https://www.facebook.com/DisneyPlus/videos/",
  ],
  entertainment: [
    "https://www.facebook.com/MrBeast6000/videos/",
    "https://www.facebook.com/DudePerfect/videos/",
    "https://www.facebook.com/RedBull/videos/",
  ],
  nature: ["https://www.facebook.com/NatGeo/videos/", "https://www.facebook.com/BBCEarth/videos/"],
  science: ["https://www.facebook.com/NASAEarth/videos/", "https://www.facebook.com/ScienceChannel/videos/"],
  sports: ["https://www.facebook.com/ESPN/videos/", "https://www.facebook.com/SportsCenter/videos/"],
  gaming: ["https://www.facebook.com/IGN/videos/"],
  food: ["https://www.facebook.com/BuzzFeedTasty/videos/", "https://www.facebook.com/5min.crafts/videos/"],
  travel: ["https://www.facebook.com/viralthread/videos/", "https://www.facebook.com/beautifuldestinations/videos/"],
  news: ["https://www.facebook.com/NowThisNews/videos/"],
  education: ["https://www.facebook.com/TEDEd/videos/", "https://www.facebook.com/BrightSide/videos/"],
  motivation: ["https://www.facebook.com/Goalcast/videos/"],
  comedy: ["https://www.facebook.com/9GAG/videos/", "https://www.facebook.com/BoredPanda/videos/", "https://www.facebook.com/FailArmy/videos/", "https://www.facebook.com/LADbible/videos/"],
  music: [],
  auto: [
    "https://www.facebook.com/ViralHog/videos/",
    "https://www.facebook.com/9GAG/videos/",
    "https://www.facebook.com/NatGeo/videos/",
    "https://www.facebook.com/ESPN/videos/",
  ],
};

const NICHE_IG_PROFILES: Record<ClipNiche, string[]> = {
  "viral-repost": [
    "https://www.instagram.com/dailydoseofinternet/",
    "https://www.instagram.com/markrober/",
    "https://www.instagram.com/viralhog/",
    "https://www.instagram.com/peopleareawesome/",
  ],
  films: [
    "https://www.instagram.com/universalpictures/",
    "https://www.instagram.com/warnerbros/",
    "https://www.instagram.com/marvelstudios/",
    "https://www.instagram.com/a24/",
  ],
  anime: [
    "https://www.instagram.com/crunchyroll/",
    "https://www.instagram.com/funimation/",
  ],
  serials: [
    "https://www.instagram.com/netflix/",
    "https://www.instagram.com/primevideo/",
    "https://www.instagram.com/hbo/",
    "https://www.instagram.com/disneyplus/",
  ],
  entertainment: [
    "https://www.instagram.com/mrbeast/",
    "https://www.instagram.com/dudeperfect/",
    "https://www.instagram.com/redbull/",
  ],
  nature: ["https://www.instagram.com/natgeo/", "https://www.instagram.com/bbcearth/"],
  science: ["https://www.instagram.com/nasa/", "https://www.instagram.com/sciencechannel/"],
  sports: ["https://www.instagram.com/espn/", "https://www.instagram.com/sportscenter/"],
  gaming: ["https://www.instagram.com/ign/"],
  food: ["https://www.instagram.com/buzzfeedtasty/"],
  travel: ["https://www.instagram.com/beautifuldestinations/"],
  news: ["https://www.instagram.com/nowthis/"],
  education: ["https://www.instagram.com/tikitoktoptips/", "https://www.instagram.com/ted/"],
  motivation: ["https://www.instagram.com/goalcast/"],
  comedy: ["https://www.instagram.com/9gag/", "https://www.instagram.com/failarmy/", "https://www.instagram.com/ladbible/"],
  music: [],
  auto: [
    "https://www.instagram.com/viralhog/",
    "https://www.instagram.com/9gag/",
    "https://www.instagram.com/natgeo/",
    "https://www.instagram.com/espn/",
  ],
};

function getChannelsForNiche(niche: ClipNiche): { yt: string[]; fb: string[]; ig: string[] } {
  if (niche === "auto") {
    const allYt = Object.values(NICHE_YT_HANDLES).flat();
    const allFb = Object.values(NICHE_FB_PAGES).flat();
    const allIg = Object.values(NICHE_IG_PROFILES).flat();
    const uniqueYt = [...new Set(allYt)];
    const uniqueFb = [...new Set(allFb)];
    const uniqueIg = [...new Set(allIg)];
    return { yt: uniqueYt.sort(() => Math.random() - 0.5).slice(0, 8), fb: uniqueFb.slice(0, 3), ig: uniqueIg.slice(0, 2) };
  }
  const yt = [...(NICHE_YT_HANDLES[niche] ?? [])];
  const fb = [...(NICHE_FB_PAGES[niche] ?? [])];
  const ig = [...(NICHE_IG_PROFILES[niche] ?? [])];
  if (yt.length < 3) {
    for (const ch of NICHE_YT_HANDLES.entertainment) {
      if (!yt.includes(ch)) yt.push(ch);
      if (yt.length >= 5) break;
    }
  }
  return { yt: yt.sort(() => Math.random() - 0.5), fb, ig };
}

const YT_RSS_BASE = "https://www.youtube.com/feeds/videos.xml";
const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

function getYouTubeApiKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY;
}

function detectPlatform(url: string): Platform {
  if (/youtube\.com|youtu\.be/i.test(url)) return "youtube";
  if (/facebook\.com|fb\.watch|fb\.com/i.test(url)) return "facebook";
  if (/instagram\.com|instagr\.am/i.test(url)) return "instagram";
  if (/tiktok\.com/i.test(url)) return "tiktok";
  if (/twitter\.com|x\.com/i.test(url)) return "twitter";
  return "other";
}

function findYtDlp(): string {
  return process.env.YTDLP_PATH ?? "yt-dlp";
}

// ---------------------------------------------------------------------------
// yt-dlp based discovery (works for ANY platform yt-dlp supports)
// ---------------------------------------------------------------------------

interface YtDlpEntry {
  id: string;
  title: string;
  url: string;
  webpage_url: string;
  duration: number;
  view_count: number;
  channel: string;
  channel_id: string;
  upload_date: string;
  extractor_key: string;
}

/**
 * Use yt-dlp to extract video metadata from any supported URL.
 * Works for YouTube channels, Facebook pages, Instagram profiles,
 * TikTok accounts, direct video URLs, and playlists.
 */
async function discoverViaYtDlp(
  sourceUrl: string,
  maxItems = 15,
): Promise<YtDlpEntry[]> {
  const args = [
    "--flat-playlist",
    "--dump-json",
    "--no-warnings",
    "--playlist-end", String(maxItems),
    "--no-download",
  ];

  const cookieFile = getCookieFilePath();
  if (cookieFile) args.push("--cookies", cookieFile);

  args.push(sourceUrl);

  try {
    const { stdout } = await execFileAsync(findYtDlp(), args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const entries: YtDlpEntry[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as Record<string, unknown>;
        entries.push({
          id: String(data.id ?? ""),
          title: String(data.title ?? ""),
          url: String(data.webpage_url ?? data.url ?? ""),
          webpage_url: String(data.webpage_url ?? data.url ?? ""),
          duration: Number(data.duration ?? 0),
          view_count: Number(data.view_count ?? 0),
          channel: String(data.channel ?? data.uploader ?? data.channel_id ?? ""),
          channel_id: String(data.channel_id ?? data.uploader_id ?? ""),
          upload_date: String(data.upload_date ?? ""),
          extractor_key: String(data.extractor_key ?? data.ie_key ?? ""),
        });
      } catch {
        // skip malformed lines
      }
    }

    log.log(`yt-dlp discovered ${entries.length} videos from ${sourceUrl}`);
    return entries;
  } catch (err) {
    log.warn(`yt-dlp discovery failed for ${sourceUrl}: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return [];
  }
}

/**
 * Resolve a single direct video URL via yt-dlp (for links to individual videos).
 */
async function resolveDirectUrl(url: string): Promise<YtDlpEntry | null> {
  const args = [
    "--dump-json",
    "--no-warnings",
    "--no-download",
    "--skip-download",
  ];

  const cookieFile = getCookieFilePath();
  if (cookieFile) args.push("--cookies", cookieFile);

  args.push(url);

  try {
    const { stdout } = await execFileAsync(findYtDlp(), args, {
      timeout: 20_000,
      maxBuffer: 5 * 1024 * 1024,
    });

    const data = JSON.parse(stdout.trim()) as Record<string, unknown>;
    return {
      id: String(data.id ?? ""),
      title: String(data.title ?? ""),
      url: String(data.webpage_url ?? data.url ?? url),
      webpage_url: String(data.webpage_url ?? data.url ?? url),
      duration: Number(data.duration ?? 0),
      view_count: Number(data.view_count ?? 0),
      channel: String(data.channel ?? data.uploader ?? ""),
      channel_id: String(data.channel_id ?? data.uploader_id ?? ""),
      upload_date: String(data.upload_date ?? ""),
      extractor_key: String(data.extractor_key ?? ""),
    };
  } catch (err) {
    log.warn(`yt-dlp resolve failed for ${url}: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// YouTube-specific enrichment (optional, uses API key)
// ---------------------------------------------------------------------------

function parseDuration(iso8601: string): number {
  const m = iso8601.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? "0") * 3600) + (parseInt(m[2] ?? "0") * 60) + parseInt(m[3] ?? "0");
}

async function fetchChannelVideosViaRss(channelId: string): Promise<string[]> {
  const url = `${YT_RSS_BASE}?channel_id=${channelId}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const xml = await res.text();
    const ids: string[] = [];
    const re = /<yt:videoId>([^<]+)<\/yt:videoId>/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(xml))) ids.push(match[1]);
    return ids;
  } catch (err) {
    log.warn(`RSS fetch failed for ${channelId}: ${err instanceof Error ? err.message : err}`);
    return [];
  }
}

async function enrichYouTubeVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, { title: string; viewCount: number; durationSec: number; channelId: string; channelName: string; publishedAt: string }>> {
  const results = new Map<string, { title: string; viewCount: number; durationSec: number; channelId: string; channelName: string; publishedAt: string }>();
  const batchSize = 50;

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics",
      id: batch.join(","),
      key: apiKey,
    });

    try {
      const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        log.warn(`YouTube API videos.list ${res.status}`);
        continue;
      }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string };
          contentDetails: { duration: string };
          statistics: { viewCount?: string };
        }>;
      };
      for (const item of data.items ?? []) {
        results.set(item.id, {
          title: item.snippet.title,
          viewCount: parseInt(item.statistics.viewCount ?? "0"),
          durationSec: parseDuration(item.contentDetails.duration),
          channelId: item.snippet.channelId,
          channelName: item.snippet.channelTitle,
          publishedAt: item.snippet.publishedAt,
        });
      }
    } catch (err) {
      log.warn(`YouTube API error: ${err instanceof Error ? err.message : err}`);
    }
  }
  return results;
}

async function fetchTrendingVideoIds(apiKey: string, regionCode = "US", maxResults = 20): Promise<string[]> {
  const params = new URLSearchParams({
    part: "id",
    chart: "mostPopular",
    regionCode,
    maxResults: String(maxResults),
    key: apiKey,
  });

  try {
    const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ id: string }> };
    return data.items?.map((i) => i.id) ?? [];
  } catch {
    return [];
  }
}

async function searchCreativeCommons(apiKey: string, maxResults = 10): Promise<string[]> {
  const params = new URLSearchParams({
    part: "id",
    type: "video",
    videoLicense: "creativeCommon",
    order: "viewCount",
    videoDuration: "medium",
    maxResults: String(maxResults),
    key: apiKey,
  });

  try {
    const res = await fetch(`${YT_API_BASE}/search?${params}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ id: { videoId: string } }> };
    return data.items?.map((i) => i.id.videoId) ?? [];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Main discovery (niche-based, multi-platform)
// ---------------------------------------------------------------------------

/**
 * Discover a single best video to clip, using niche-based auto-discovery.
 *
 * The niche determines which YouTube channels and Facebook pages to search.
 * Also always includes YouTube trending. Returns both the selected video
 * and a summary of all candidates considered (for transparency in the UI).
 */
export async function discoverVideo(config: {
  niche: ClipNiche;
  excludeVideoIds: Set<string>;
  minViewCount?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  preferPlatform?: "youtube" | "facebook" | "instagram";
}): Promise<DiscoveryResult | null> {
  const ytApiKey = getYouTubeApiKey();
  const pref = config.preferPlatform;
  const defaultMinViews = config.minViewCount ?? 500_000;
  const igMinViews = 5_000; // IG reels accumulate views over time
  const minDur = config.minDurationSec ?? 5;
  const maxDur = config.maxDurationSec ?? 3600;

  const allCandidates: DiscoveredVideo[] = [];
  const { yt: ytChannels, fb: fbPages, ig: igProfiles } = getChannelsForNiche(config.niche);

  log.log(`[DISCOVER] Niche "${config.niche}" → ${ytChannels.length} YT, ${fbPages.length} FB, ${igProfiles.length} IG${pref ? ` (prefer: ${pref})` : ""}`);

  // ── 1. YouTube channels for this niche (via yt-dlp handle scraping) ──
  if (!pref || pref === "youtube") {
    for (const handleUrl of ytChannels) {
      const entries = await discoverViaYtDlp(handleUrl, 5);
      for (const e of entries) {
        if (e.id) {
          allCandidates.push({
            videoId: e.id, url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
            title: e.title, channelId: e.channel_id, channelName: e.channel,
            viewCount: e.view_count, publishedAt: e.upload_date,
            durationSec: e.duration, platform: "youtube", source: "channel",
          });
        }
      }
    }
  }

  // ── 2. YouTube Trending (when API key available) ──
  if (ytApiKey && (!pref || pref === "youtube")) {
    const ids = await fetchTrendingVideoIds(ytApiKey);
    for (const id of ids) {
      allCandidates.push({
        videoId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: "", channelId: "", channelName: "",
        viewCount: 0, publishedAt: "", durationSec: 0,
        platform: "youtube", source: "trending",
      });
    }
  }

  // ── 3. YouTube Creative Commons (when API key available) ──
  if (ytApiKey && (!pref || pref === "youtube")) {
    const ids = await searchCreativeCommons(ytApiKey);
    for (const id of ids) {
      allCandidates.push({
        videoId: id,
        url: `https://www.youtube.com/watch?v=${id}`,
        title: "", channelId: "", channelName: "",
        viewCount: 0, publishedAt: "", durationSec: 0,
        platform: "youtube", source: "creative-commons",
      });
    }
  }

  // ── 4. Facebook Pages for this niche (via browser scraper) ──
  if (!pref || pref === "facebook") {
    for (const fbUrl of fbPages) {
      try {
        const fbVideos = await discoverFbPageVideos(fbUrl, 10);
        for (const v of fbVideos) {
          if (v.videoId) {
            allCandidates.push({
              videoId: v.videoId, url: v.url, title: v.title,
              channelId: "", channelName: v.channelName,
              viewCount: v.viewCount, publishedAt: "",
              durationSec: v.durationSec, platform: "facebook", source: "channel",
            });
          }
        }
      } catch (err) {
        log.warn(`FB browser scrape failed for ${fbUrl}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // ── 5. Instagram Profiles for this niche (via browser scraper) ──
  if (!pref || pref === "instagram") {
    for (const igUrl of igProfiles) {
      try {
        const igReels = await discoverIgReels(igUrl, 10);
        for (const v of igReels) {
          if (v.videoId) {
            allCandidates.push({
              videoId: v.videoId, url: v.url, title: v.title,
              channelId: "", channelName: v.channelName,
              viewCount: v.viewCount, publishedAt: "",
              durationSec: v.durationSec, platform: "instagram", source: "channel",
            });
          }
        }
      } catch (err) {
        log.warn(`IG browser scrape failed for ${igUrl}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  // ── Deduplicate and exclude already-processed ──
  const seen = new Set<string>();
  const unique = allCandidates.filter((v) => {
    const key = `${v.platform}:${v.videoId}`;
    if (seen.has(key) || config.excludeVideoIds.has(v.videoId) || config.excludeVideoIds.has(v.url)) return false;
    seen.add(key);
    return true;
  });

  if (unique.length === 0) {
    log.warn("No candidate videos found from any source");
    return null;
  }

  // ── Enrich candidates that lack metadata ──
  const ytNeedEnrich = unique.filter((v) => v.platform === "youtube" && !v.title);
  if (ytNeedEnrich.length > 0 && ytApiKey) {
    const details = await enrichYouTubeVideoDetails(ytNeedEnrich.map((v) => v.videoId), ytApiKey);
    for (const v of ytNeedEnrich) {
      const d = details.get(v.videoId);
      if (d) {
        v.title = d.title;
        v.viewCount = d.viewCount;
        v.durationSec = d.durationSec;
        v.channelId = d.channelId;
        v.channelName = d.channelName;
        v.publishedAt = d.publishedAt;
      }
    }
  }

  const stillNeedEnrich = unique.filter((v) => !v.title && v.url);
  if (stillNeedEnrich.length > 0) {
    log.log(`Enriching ${stillNeedEnrich.length} candidates via yt-dlp...`);
    for (const v of stillNeedEnrich.slice(0, 10)) {
      const entry = await resolveDirectUrl(v.url);
      if (entry) {
        v.title = entry.title || v.title;
        v.viewCount = entry.view_count || v.viewCount;
        v.durationSec = entry.duration || v.durationSec;
        v.channelName = entry.channel || v.channelName;
        v.channelId = entry.channel_id || v.channelId;
      }
    }
  }

  // ── Score and filter (per-platform view thresholds) ──
  const scored = unique.filter((v) => {
    const minV = v.platform === "instagram" ? igMinViews : defaultMinViews;
    if (v.viewCount > 0 && v.viewCount < minV) return false;
    if (v.durationSec > 0 && (v.durationSec < minDur || v.durationSec > maxDur)) return false;
    return true;
  });

  if (scored.length === 0) {
    log.warn(`No videos passed filters (${unique.length} candidates, minViews=${defaultMinViews}/${igMinViews}ig, dur=${minDur}-${maxDur}s)`);
    return null;
  }

  // Multi-factor scoring: views (60%), platform bonus (20%), source quality (20%)
  const maxViews = Math.max(...scored.map((v) => v.viewCount), 1);
  const scoredWithRank = scored.map((v) => {
    let score = 0;

    // View score (0-60): normalized against max, log-scaled for fairer distribution
    const viewScore = v.viewCount > 0
      ? (Math.log10(v.viewCount) / Math.log10(Math.max(maxViews, 10))) * 60
      : 0;
    score += viewScore;

    // Platform bonus (0-20): FB/IG clips are already short-form optimized
    const platformBonus: Record<string, number> = {
      facebook: 20, instagram: 18, youtube: 12, tiktok: 15, other: 5,
    };
    score += platformBonus[v.platform] ?? 5;

    // Source quality (0-20): official channels > creative-commons > trending
    const sourceBonus: Record<string, number> = {
      channel: 20, trending: 15, "creative-commons": 18, direct: 10,
    };
    score += sourceBonus[v.source] ?? 5;

    // Non-copyright creator bonus: extra 5 points for known safe-to-repost channels
    const safeChannels = ["mrbeast", "mark rober", "daily dose", "dude perfect", "ryan trahan", "airrack", "ben azelart"];
    if (safeChannels.some((c) => v.channelName.toLowerCase().includes(c))) {
      score += 5;
    }

    // Niche relevance scoring: boost matching titles, penalize off-topic content
    if (config.niche !== "auto" && config.niche !== "viral-repost") {
      const titleLower = (v.title || "").toLowerCase();
      const nicheSignals: Record<string, { positive: string[]; negative: string[] }> = {
        comedy:        { positive: ["funny", "fail", "prank", "laugh", "comedy", "hilarious", "joke", "humor", "meme", "skit", "sketch", "lol", "rofl"],
                         negative: ["wildlife", "documentary", "science", "recipe", "tutorial", "meditation", "workout", "news"] },
        films:         { positive: ["movie", "film", "scene", "trailer", "cinema", "actor", "actress", "oscar", "blockbuster"],
                         negative: ["recipe", "workout", "tutorial", "gaming", "gameplay"] },
        anime:         { positive: ["anime", "manga", "otaku", "naruto", "dragon ball", "one piece", "jujutsu", "demon slayer", "amv"],
                         negative: ["recipe", "workout", "news", "documentary"] },
        serials:       { positive: ["serial", "episode", "drama", "sitcom", "tv show", "series", "season"],
                         negative: ["recipe", "workout", "gaming", "gameplay"] },
        entertainment: { positive: ["stunt", "challenge", "prank", "viral", "amazing", "insane", "crazy", "unbelievable"],
                         negative: ["recipe", "tutorial", "meditation", "documentary"] },
        nature:        { positive: ["nature", "animal", "wildlife", "ocean", "forest", "bird", "dog", "cat", "planet", "earth", "safari"],
                         negative: ["gaming", "gameplay", "comedy", "prank", "skit"] },
        science:       { positive: ["science", "physics", "experiment", "space", "nasa", "engineer", "tech", "robot", "quantum", "atom"],
                         negative: ["comedy", "prank", "recipe", "workout"] },
        sports:        { positive: ["goal", "sport", "match", "player", "team", "football", "basketball", "cricket", "tennis", "olympic", "highlight", "slam dunk"],
                         negative: ["recipe", "tutorial", "meditation", "anime"] },
        gaming:        { positive: ["game", "gaming", "gameplay", "esport", "speedrun", "gamer", "xbox", "playstation", "pc", "fortnite", "minecraft"],
                         negative: ["recipe", "workout", "news", "documentary"] },
        food:          { positive: ["food", "recipe", "cook", "chef", "kitchen", "eat", "taste", "restaurant", "bake", "street food", "mukbang"],
                         negative: ["gaming", "gameplay", "anime", "sport"] },
        travel:        { positive: ["travel", "destination", "explore", "adventure", "country", "city", "backpack", "flight", "hotel", "culture"],
                         negative: ["gaming", "gameplay", "anime", "recipe"] },
        news:          { positive: ["news", "breaking", "report", "analysis", "politic", "economy", "crisis", "update"],
                         negative: ["gaming", "recipe", "anime", "comedy"] },
        education:     { positive: ["learn", "explain", "how to", "tutorial", "history", "fact", "lesson", "course", "guide"],
                         negative: ["gaming", "prank", "comedy", "meme"] },
        motivation:    { positive: ["motivat", "inspir", "success", "speech", "mindset", "discipline", "hustle", "grind", "self help", "productiv"],
                         negative: ["gaming", "prank", "comedy", "meme", "recipe"] },
        music:         { positive: ["music", "song", "dance", "singer", "concert", "cover", "beat", "rap", "dj", "perform", "choreograph"],
                         negative: ["gaming", "recipe", "news", "documentary"] },
      };
      const signals = nicheSignals[config.niche];
      if (signals) {
        if (signals.positive.some((kw) => titleLower.includes(kw))) score += 10;
        if (signals.negative.some((kw) => titleLower.includes(kw))) score -= 15;
      }
    }

    return { ...v, score: Math.round(score * 100) / 100 };
  });

  scoredWithRank.sort((a, b) => b.score - a.score);

  const best = scoredWithRank[0];

  // Build candidates summary for UI transparency (with scores)
  const candidatesSummary = scoredWithRank.slice(0, 20).map((v) => ({
    title: v.title || "(untitled)",
    url: v.url,
    viewCount: v.viewCount,
    platform: v.platform,
    channelName: v.channelName || "(unknown)",
    score: v.score,
  }));

  log.log(`Discovered: "${best.title}" (${best.viewCount.toLocaleString()} views, score=${best.score}) [${best.platform}/${best.source}] from ${unique.length} total candidates`);
  return { selected: best, candidates: candidatesSummary, totalConsidered: unique.length };
}
