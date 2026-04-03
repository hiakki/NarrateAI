import { execFile } from "child_process";
import { promisify } from "util";
import { createLogger } from "@/lib/logger";
import { getCookieFilePath } from "@/lib/cookie-path";
import { searchFbVideos, discoverFbPageVideos, searchIgReels, discoverIgReels } from "./browser-scraper";

const execFileAsync = promisify(execFile);
const log = createLogger("ClipDiscovery");
const FB_SCRAPE_TARGET_LIMIT = Math.max(2, parseInt(process.env.CLIP_DISCOVERY_FB_SCRAPE_TARGET_LIMIT ?? "6", 10));
const IG_SCRAPE_TARGET_LIMIT = Math.max(2, parseInt(process.env.CLIP_DISCOVERY_IG_SCRAPE_TARGET_LIMIT ?? "6", 10));

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
  source: "search" | "channel" | "trending" | "creative-commons" | "direct";
  likeCount?: number;
  commentCount?: number;
  licensedContent?: boolean;
}

export interface DiscoveryResult {
  selected: DiscoveredVideo;
  rankedCandidates: DiscoveredVideo[];
  candidates: Array<{ title: string; url: string; viewCount: number; platform: string; channelName: string; score?: number }>;
  totalConsidered: number;
  platformBreakdown: Record<string, { found: number; qualified: number; rejected: number }>;
  rejectedSample: Array<{ title: string; platform: string; viewCount: number; reason: string }>;
}

// ── Niche → channel mapping ──────────────────────────────────────────────────
export type ClipNiche =
  | "viral-repost" | "entertainment" | "films" | "anime" | "serials"
  | "nature" | "science" | "sports" | "gaming"
  | "food" | "travel" | "news" | "education" | "motivation"
  | "comedy" | "music"
  | "satisfying" | "fails" | "animals" | "food-viral" | "luxury" | "extreme"
  | "diy" | "wholesome" | "scary" | "prank"
  | "auto";

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
  satisfying:    { label: "Satisfying & ASMR", description: "Oddly satisfying clips — soap cutting, kinetic sand, slime, hydraulic press", icon: "🫧" },
  fails:         { label: "Fails & Unexpected", description: "Funny fails, unexpected moments, caught on camera", icon: "🤯" },
  animals:       { label: "Animals & Pets", description: "Cute and funny animal moments, pet compilations", icon: "🐾" },
  "food-viral":  { label: "Food Viral", description: "Street food processes, satisfying cooking, food art", icon: "🍜" },
  luxury:        { label: "Luxury & Supercars", description: "Exotic cars, mansions, luxury lifestyle, aspirational", icon: "🏎️" },
  extreme:       { label: "Extreme Sports & Stunts", description: "Parkour, GoPro moments, adrenaline stunts, daredevils", icon: "🪂" },
  diy:           { label: "DIY & Life Hacks", description: "Crafts, life hacks, restoration, build projects, 5-minute fixes", icon: "🔧" },
  wholesome:     { label: "Wholesome & Feel-Good", description: "Heartwarming reunions, acts of kindness, surprise reactions, emotional moments", icon: "🥹" },
  scary:         { label: "Scary & Paranormal", description: "Creepy caught on camera, trail cam footage, ghost sightings, unsolved mysteries", icon: "👻" },
  prank:         { label: "Pranks", description: "Prank compilations, hidden camera, social experiments, public reactions", icon: "🎃" },
  auto:          { label: "Auto (All Niches)", description: "Mix from all trending content", icon: "🔄" },
};

// ── Primary: niche → YouTube search queries (yt-dlp ytsearch:) ──────────────
export const NICHE_SEARCH_QUERIES: Record<ClipNiche, string[]> = {
  "viral-repost": ["viral video this week no copyright", "free to repost viral video"],
  films:         ["iconic movie scene", "film trailer reaction trending"],
  anime:         ["anime fight scene epic", "anime emotional moment viral"],
  serials:       ["tv show best scene", "series clip trending"],
  entertainment: ["viral challenge insane", "amazing stunts unbelievable"],
  nature:        ["wildlife amazing moment", "nature documentary breathtaking"],
  science:       ["science experiment mind blowing", "space discovery new"],
  sports:        ["sports highlight this week", "best goal incredible play"],
  gaming:        ["gaming clutch moment viral", "esports best play highlight"],
  food:          ["street food viral", "cooking challenge amazing"],
  travel:        ["travel hidden gem beautiful", "amazing destination explore"],
  news:          ["breaking news analysis today", "world event explained"],
  education:     ["explained viral how things work", "mind blowing facts"],
  motivation:    ["motivational speech powerful", "success story inspiring never give up"],
  comedy:        ["funny viral video", "comedy sketch hilarious"],
  music:         ["music performance viral amazing", "dance trending choreography"],
  satisfying:    ["oddly satisfying compilation", "satisfying ASMR viral", "hydraulic press crushing satisfying"],
  fails:         ["funny fail compilation viral", "unexpected moment caught on camera", "instant regret fail"],
  animals:       ["funny animal viral moment", "cute pet compilation", "animals being derps"],
  "food-viral":  ["street food amazing process viral", "satisfying cooking compilation", "food art incredible"],
  luxury:        ["supercar viral moment", "luxury lifestyle unbelievable", "exotic car compilation"],
  extreme:       ["extreme sport insane moment viral", "parkour unbelievable stunt", "GoPro adrenaline compilation"],
  diy:           ["DIY life hack viral", "amazing restoration before after", "5 minute crafts incredible"],
  wholesome:     ["wholesome moment caught on camera", "heartwarming surprise reunion viral", "faith in humanity restored"],
  scary:         ["creepy caught on camera compilation", "scary trail cam footage unexplained", "ghost sighting paranormal viral"],
  prank:         ["best prank compilation viral", "hidden camera prank hilarious", "public prank social experiment"],
  auto:          ["trending viral video today", "most viewed video this week"],
};

// ── Niche → Facebook pages (verified working scraper targets) ────────────────
const NICHE_FB_PAGES: Record<string, string[]> = {
  "viral-repost": ["https://www.facebook.com/9GAG/videos/", "https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/UNILAD/videos/", "https://www.facebook.com/TheEllenShow/videos/"],
  films:         ["https://www.facebook.com/RottenTomatoes/videos/", "https://www.facebook.com/IGN/videos/", "https://www.facebook.com/20thCenturyStudios/videos/"],
  anime:         ["https://www.facebook.com/Crunchyroll/videos/", "https://www.facebook.com/AnimeUproar/videos/", "https://www.facebook.com/Funimation/videos/"],
  serials:       ["https://www.facebook.com/netflix/videos/", "https://www.facebook.com/HBO/videos/", "https://www.facebook.com/PrimeVideo/videos/"],
  entertainment: ["https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/9GAG/videos/", "https://www.facebook.com/UNILAD/videos/", "https://www.facebook.com/BuzzFeedVideo/videos/"],
  nature:        ["https://www.facebook.com/BBCEarth/videos/", "https://www.facebook.com/NationalGeographic/videos/", "https://www.facebook.com/DiscoveryChannel/videos/"],
  science:       ["https://www.facebook.com/NASA/videos/", "https://www.facebook.com/TED/videos/", "https://www.facebook.com/ScienceChannel/videos/"],
  sports:        ["https://www.facebook.com/ESPN/videos/", "https://www.facebook.com/bleacherreport/videos/", "https://www.facebook.com/NFL/videos/"],
  gaming:        ["https://www.facebook.com/IGN/videos/", "https://www.facebook.com/GameSpot/videos/", "https://www.facebook.com/playstation/videos/"],
  food:          ["https://www.facebook.com/buzzfeedtasty/videos/", "https://www.facebook.com/GordonRamsay/videos/", "https://www.facebook.com/SoYummy/videos/"],
  travel:        ["https://www.facebook.com/BeautifulDestinations/videos/", "https://www.facebook.com/NationalGeographic/videos/", "https://www.facebook.com/LonelyPlanet/videos/"],
  news:          ["https://www.facebook.com/BBCNews/videos/", "https://www.facebook.com/Vox/videos/", "https://www.facebook.com/NowThisNews/videos/"],
  education:     ["https://www.facebook.com/TED/videos/", "https://www.facebook.com/Vox/videos/", "https://www.facebook.com/NatGeo/videos/"],
  motivation:    ["https://www.facebook.com/Goalcast/videos/", "https://www.facebook.com/motivationhub/videos/", "https://www.facebook.com/PrinceEa/videos/"],
  comedy:        ["https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/9GAG/videos/", "https://www.facebook.com/UNILAD/videos/"],
  music:         ["https://www.facebook.com/MTV/videos/", "https://www.facebook.com/Vevo/videos/", "https://www.facebook.com/Spotify/videos/"],
  satisfying:    ["https://www.facebook.com/oddlysatisfying/videos/", "https://www.facebook.com/TheOddlySatisfying/videos/", "https://www.facebook.com/5MinuteCrafts/videos/"],
  fails:         ["https://www.facebook.com/FailArmy/videos/", "https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/PeopleSoStupid/videos/"],
  animals:       ["https://www.facebook.com/TheDodo/videos/", "https://www.facebook.com/PetCollective/videos/", "https://www.facebook.com/9GAGCute/videos/"],
  "food-viral":  ["https://www.facebook.com/buzzfeedtasty/videos/", "https://www.facebook.com/StreetFoodOfficial/videos/", "https://www.facebook.com/SoYummy/videos/"],
  luxury:        ["https://www.facebook.com/Supercarblondie/videos/", "https://www.facebook.com/LuxuryListings/videos/", "https://www.facebook.com/MotorTrend/videos/"],
  extreme:       ["https://www.facebook.com/redbull/videos/", "https://www.facebook.com/PeopleSoAwesome/videos/", "https://www.facebook.com/GoPro/videos/"],
  diy:           ["https://www.facebook.com/5MinuteCrafts/videos/", "https://www.facebook.com/BlossomdIY/videos/", "https://www.facebook.com/NiftyBuzzFeed/videos/"],
  wholesome:     ["https://www.facebook.com/Goalcast/videos/", "https://www.facebook.com/SomeGoodNews/videos/", "https://www.facebook.com/TheDodo/videos/"],
  scary:         ["https://www.facebook.com/NukesTop5/videos/", "https://www.facebook.com/Chills/videos/", "https://www.facebook.com/SlappedHam/videos/"],
  prank:         ["https://www.facebook.com/JustForLaughsGags/videos/", "https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/UNILAD/videos/"],
  auto:          ["https://www.facebook.com/LADbible/videos/", "https://www.facebook.com/9GAG/videos/", "https://www.facebook.com/UNILAD/videos/"],
};

// ── Niche → Instagram profiles (working scraper targets) ─────────────────────
const NICHE_IG_PROFILES: Record<string, string[]> = {
  "viral-repost": ["https://www.instagram.com/pubity/", "https://www.instagram.com/bestvines/", "https://www.instagram.com/dailydoseofinternet/", "https://www.instagram.com/theshaderoom/"],
  films:         ["https://www.instagram.com/rottentomatoes/", "https://www.instagram.com/ign/", "https://www.instagram.com/cinema.magic/"],
  anime:         ["https://www.instagram.com/crunchyroll/", "https://www.instagram.com/anime/", "https://www.instagram.com/funimation/"],
  serials:       ["https://www.instagram.com/netflix/", "https://www.instagram.com/hbo/", "https://www.instagram.com/primevideo/"],
  entertainment: ["https://www.instagram.com/ladbible/", "https://www.instagram.com/9gag/", "https://www.instagram.com/unilad/", "https://www.instagram.com/complex/"],
  nature:        ["https://www.instagram.com/natgeo/", "https://www.instagram.com/bbcearth/", "https://www.instagram.com/discoverearth/"],
  science:       ["https://www.instagram.com/nasa/", "https://www.instagram.com/sciencechannel/", "https://www.instagram.com/ifuckinglovescience/"],
  sports:        ["https://www.instagram.com/espn/", "https://www.instagram.com/bleacherreport/", "https://www.instagram.com/sportscenter/"],
  gaming:        ["https://www.instagram.com/ign/", "https://www.instagram.com/gamespot/", "https://www.instagram.com/playstation/"],
  food:          ["https://www.instagram.com/buzzfeedtasty/", "https://www.instagram.com/gordonramsay/", "https://www.instagram.com/foodnetwork/"],
  travel:        ["https://www.instagram.com/beautifuldestinations/", "https://www.instagram.com/natgeotravel/", "https://www.instagram.com/earthpix/"],
  news:          ["https://www.instagram.com/bbcnews/", "https://www.instagram.com/cnn/", "https://www.instagram.com/nowthisnews/"],
  education:     ["https://www.instagram.com/ted/", "https://www.instagram.com/vox/", "https://www.instagram.com/natgeo/"],
  motivation:    ["https://www.instagram.com/goalcast/", "https://www.instagram.com/garyvee/", "https://www.instagram.com/tonytrobbins/"],
  comedy:        ["https://www.instagram.com/9gag/", "https://www.instagram.com/ladbible/", "https://www.instagram.com/unilad/"],
  music:         ["https://www.instagram.com/mtv/", "https://www.instagram.com/spotify/", "https://www.instagram.com/billboard/"],
  satisfying:    ["https://www.instagram.com/satisfying/", "https://www.instagram.com/oddlysatisfying/", "https://www.instagram.com/asmr/"],
  fails:         ["https://www.instagram.com/failarmy/", "https://www.instagram.com/pubity/", "https://www.instagram.com/bestamazingvideos/"],
  animals:       ["https://www.instagram.com/thedodo/", "https://www.instagram.com/animals.co/", "https://www.instagram.com/barked/"],
  "food-viral":  ["https://www.instagram.com/buzzfeedtasty/", "https://www.instagram.com/streetfoodcinema/", "https://www.instagram.com/foodiesfeed/"],
  luxury:        ["https://www.instagram.com/supercarblondie/", "https://www.instagram.com/luxurylife/", "https://www.instagram.com/carlifestyle/"],
  extreme:       ["https://www.instagram.com/redbull/", "https://www.instagram.com/gopro/", "https://www.instagram.com/storror/"],
  diy:           ["https://www.instagram.com/5.min" + ".crafts/", "https://www.instagram.com/nifty/", "https://www.instagram.com/diy/"],
  wholesome:     ["https://www.instagram.com/goodnews_movement/", "https://www.instagram.com/thedodo/", "https://www.instagram.com/pubity/"],
  scary:         ["https://www.instagram.com/creepypasta/", "https://www.instagram.com/paranormal/", "https://www.instagram.com/scaryfacts/"],
  prank:         ["https://www.instagram.com/justforlaughs/", "https://www.instagram.com/9gag/", "https://www.instagram.com/ladbible/"],
  auto:          ["https://www.instagram.com/pubity/", "https://www.instagram.com/9gag/", "https://www.instagram.com/theshaderoom/"],
};

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

function getYouTubeApiKey(): string | undefined {
  return process.env.YOUTUBE_API_KEY;
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
  live_status: string;
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
    const NOT_DOWNLOADABLE = new Set(["is_upcoming", "is_live", "post_live"]);
    const nowEpoch = Math.floor(Date.now() / 1000);
    let skipped = 0;
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line) as Record<string, unknown>;

        const liveStatus = String(data.live_status ?? "");
        if (NOT_DOWNLOADABLE.has(liveStatus) || data.is_live === true) { skipped++; continue; }

        const releaseTs = Number(data.release_timestamp ?? 0);
        if (releaseTs > nowEpoch) { skipped++; continue; }

        const avail = String(data.availability ?? "");
        if (avail === "needs_auth" || avail === "premium_only" || avail === "subscriber_only") { skipped++; continue; }

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
          live_status: liveStatus,
        });
      } catch {
        // skip malformed lines
      }
    }

    if (skipped > 0) log.log(`Skipped ${skipped} non-downloadable entries (live/upcoming/premiere/restricted)`);
    log.log(`yt-dlp discovered ${entries.length} downloadable videos from ${sourceUrl}`);
    return entries;
  } catch (err) {
    log.warn(`yt-dlp discovery failed for ${sourceUrl}: ${err instanceof Error ? err.message.slice(0, 200) : err}`);
    return [];
  }
}

/**
 * Search YouTube for trending content in a niche using yt-dlp's ytsearch.
 * This is the primary discovery method — finds actually-trending content
 * instead of just scraping latest uploads from specific channels.
 */
export async function discoverViaSearch(
  niche: ClipNiche,
  maxPerQuery = 10,
): Promise<YtDlpEntry[]> {
  const queries = NICHE_SEARCH_QUERIES[niche] ?? NICHE_SEARCH_QUERIES.auto;
  const all: YtDlpEntry[] = [];

  for (const query of queries) {
    const searchUrl = `ytsearch${maxPerQuery}:${query}`;
    const entries = await discoverViaYtDlp(searchUrl, maxPerQuery);
    all.push(...entries);
  }

  const seen = new Set<string>();
  return all.filter((e) => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });
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
      live_status: String(data.live_status ?? ""),
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

interface EnrichedVideoDetail {
  title: string; viewCount: number; durationSec: number;
  channelId: string; channelName: string; publishedAt: string;
  likeCount: number; commentCount: number; licensedContent: boolean;
}

async function enrichYouTubeVideoDetails(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, EnrichedVideoDetail>> {
  const results = new Map<string, EnrichedVideoDetail>();
  const batchSize = 50;

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const params = new URLSearchParams({
      part: "snippet,contentDetails,statistics,status",
      id: batch.join(","),
      key: apiKey,
    });

    try {
      const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { log.warn(`YouTube API videos.list ${res.status}`); continue; }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          snippet: { title: string; channelId: string; channelTitle: string; publishedAt: string };
          contentDetails: { duration: string; licensedContent?: boolean };
          statistics: { viewCount?: string; likeCount?: string; commentCount?: string };
          status: { license?: string };
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
          likeCount: parseInt(item.statistics.likeCount ?? "0"),
          commentCount: parseInt(item.statistics.commentCount ?? "0"),
          licensedContent: item.contentDetails.licensedContent ?? false,
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
// Copyright pre-screening (YouTube only, requires API key)
// ---------------------------------------------------------------------------

interface CopyrightInfo {
  licensedContent: boolean;
  license: string;
  likeCount: number;
  commentCount: number;
}

async function copyrightPreScreen(
  videoIds: string[],
  apiKey: string,
): Promise<Map<string, CopyrightInfo>> {
  const results = new Map<string, CopyrightInfo>();
  const batchSize = 50;

  for (let i = 0; i < videoIds.length; i += batchSize) {
    const batch = videoIds.slice(i, i + batchSize);
    const params = new URLSearchParams({
      part: "contentDetails,status,statistics",
      id: batch.join(","),
      key: apiKey,
    });

    try {
      const res = await fetch(`${YT_API_BASE}/videos?${params}`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) { log.warn(`Copyright screen API ${res.status}`); continue; }
      const data = (await res.json()) as {
        items?: Array<{
          id: string;
          contentDetails: { licensedContent?: boolean };
          status: { license?: string };
          statistics: { likeCount?: string; commentCount?: string };
        }>;
      };
      for (const item of data.items ?? []) {
        results.set(item.id, {
          licensedContent: item.contentDetails.licensedContent ?? false,
          license: item.status.license ?? "youtube",
          likeCount: parseInt(item.statistics.likeCount ?? "0"),
          commentCount: parseInt(item.statistics.commentCount ?? "0"),
        });
      }
    } catch (err) {
      log.warn(`Copyright screen error: ${err instanceof Error ? err.message : err}`);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Niche relevance signals (shared across scoring)
// ---------------------------------------------------------------------------

const NICHE_SIGNALS: Record<string, { positive: string[]; negative: string[] }> = {
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
  motivation:    { positive: ["motivat", "inspir", "success", "speech", "mindset", "discipline", "hustle", "grind", "self help", "productiv", "goal", "dream", "believe", "never give up", "persever", "resilien"],
                   negative: ["gaming", "prank", "comedy", "meme", "recipe", "futuristic", "vs ", "$1 vs", "gameplay"] },
  music:         { positive: ["music", "song", "dance", "singer", "concert", "cover", "beat", "rap", "dj", "perform", "choreograph"],
                   negative: ["gaming", "recipe", "news", "documentary"] },
  satisfying:    { positive: ["satisfying", "asmr", "oddly", "slime", "kinetic sand", "soap", "hydraulic", "crushing", "cutting"],
                   negative: ["news", "politics", "workout", "tutorial", "gaming"] },
  fails:         { positive: ["fail", "unexpected", "instant regret", "caught on camera", "gone wrong", "oops", "what could go wrong"],
                   negative: ["recipe", "tutorial", "meditation", "documentary", "workout"] },
  animals:       { positive: ["animal", "pet", "dog", "cat", "puppy", "kitten", "cute", "funny animal", "parrot", "bunny"],
                   negative: ["gaming", "recipe", "politics", "workout", "tutorial"] },
  "food-viral":  { positive: ["street food", "food art", "cooking", "satisfying food", "food process", "chef", "kitchen"],
                   negative: ["gaming", "anime", "sport", "workout", "politics"] },
  luxury:        { positive: ["supercar", "luxury", "mansion", "exotic", "lamborghini", "ferrari", "rolls royce", "penthouse", "yacht"],
                   negative: ["recipe", "anime", "gaming", "news", "tutorial"] },
  extreme:       { positive: ["extreme", "parkour", "gopro", "adrenaline", "base jump", "wingsuit", "skydiv", "surfing", "bmx"],
                   negative: ["recipe", "anime", "gaming", "news", "tutorial"] },
  diy:           { positive: ["diy", "hack", "craft", "restor", "build", "homemade", "upcycle", "repurpos", "fix", "woodwork", "how to make"],
                   negative: ["gaming", "anime", "sport", "news", "comedy"] },
  wholesome:     { positive: ["wholesome", "heartwarming", "reunion", "surprise", "kindness", "emotional", "faith in humanity", "soldier", "proposal", "happy tears"],
                   negative: ["gaming", "recipe", "politics", "horror", "scary"] },
  scary:         { positive: ["scary", "creepy", "paranormal", "ghost", "haunt", "unexplain", "trail cam", "horror", "mysterious", "caught on camera", "demon"],
                   negative: ["recipe", "wholesome", "cute", "comedy", "cooking"] },
  prank:         { positive: ["prank", "hidden camera", "social experiment", "public reaction", "candid", "scare prank", "gotcha"],
                   negative: ["recipe", "tutorial", "documentary", "meditation", "workout"] },
};

// ---------------------------------------------------------------------------
// Quality scoring (extracted for reuse by trending probe)
// ---------------------------------------------------------------------------

export function scoreCandidate(
  v: DiscoveredVideo,
  niche: ClipNiche,
  copyrightMap?: Map<string, { licensedContent: boolean; license: string }>,
): number {
  const nowMs = Date.now();
  let score = 40;

  if (v.viewCount >= 100_000_000) score += 35;
  else if (v.viewCount >= 50_000_000) score += 32;
  else if (v.viewCount >= 20_000_000) score += 28;
  else if (v.viewCount >= 10_000_000) score += 24;
  else if (v.viewCount >= 5_000_000) score += 20;
  else if (v.viewCount >= 2_000_000) score += 15;
  else if (v.viewCount >= 1_000_000) score += 10;
  else if (v.viewCount >= 500_000) score += 6;
  else if (v.viewCount >= 200_000) score += 3;
  else if (v.viewCount >= 50_000) score += 1;

  let ageDays = 30;
  let hasRealDate = false;
  if (v.publishedAt) {
    const pubMs = v.publishedAt.length === 8
      ? new Date(`${v.publishedAt.slice(0, 4)}-${v.publishedAt.slice(4, 6)}-${v.publishedAt.slice(6, 8)}`).getTime()
      : new Date(v.publishedAt).getTime();
    if (!isNaN(pubMs)) {
      ageDays = Math.max(1, (nowMs - pubMs) / 86_400_000);
      hasRealDate = true;
    }
  }
  if (hasRealDate) {
    const velocity = v.viewCount / ageDays;
    score += velocity > 0 ? Math.min(10, Math.log10(velocity) * 2) : 0;
  }

  if (v.likeCount && v.viewCount > 0) score += Math.min(3, (v.likeCount / v.viewCount) * 100);
  if (v.commentCount && v.viewCount > 0) score += Math.min(2, (v.commentCount / v.viewCount) * 500);

  if (hasRealDate) {
    if (ageDays <= 3) score += 8;
    else if (ageDays <= 7) score += 5;
    else if (ageDays <= 14) score += 3;
    else if (ageDays > 180) score -= 5;
  }

  if (v.licensedContent) score -= 40;
  const crInfo = copyrightMap?.get(v.videoId);
  if (crInfo?.license === "creativeCommon") score += 10;

  const sourceBonus: Record<string, number> = { search: 2, "creative-commons": 5, trending: 3, direct: 0 };
  score += sourceBonus[v.source] ?? 0;

  const safeChannels = ["mrbeast", "mark rober", "daily dose", "dude perfect", "ryan trahan", "airrack", "ben azelart", "viral hog", "people are awesome"];
  if (safeChannels.some((c) => v.channelName.toLowerCase().includes(c))) score += 5;

  if (niche !== "auto" && niche !== "viral-repost") {
    const titleLower = (v.title || "").toLowerCase();
    const signals = NICHE_SIGNALS[niche];
    if (signals) {
      if (signals.positive.some((kw) => titleLower.includes(kw))) score += 8;
      if (signals.negative.some((kw) => titleLower.includes(kw))) score -= 15;
    }
  }

  return Math.round(Math.min(100, Math.max(0, score)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Main discovery (search-first, multi-platform)
// ---------------------------------------------------------------------------

/**
 * Discover a single best video to clip.
 *
 * Pipeline:
 *   1. SEARCH YT — yt-dlp ytsearch for trending niche content
 *   2. SEARCH FB — browser scraper Facebook video search
 *   3. SEARCH IG — browser scraper Instagram tag search
 *   4. TRENDING + CC — YouTube API trending & Creative Commons (when key available)
 *   5. ENRICH — fill in metadata for API-sourced candidates
 *   6. COPYRIGHT SCREEN — YouTube API licensedContent check
 *   7. QUALITY SCORE — engagement, recency, velocity, niche relevance, copyright risk
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
  const hasCookieFile = !!getCookieFilePath();
  const minViews = config.minViewCount ?? 500_000;
  const fbMinViews = 100_000;
  const igMinViews = 50_000;
  const minDur = config.minDurationSec ?? 60;
  const maxDur = config.maxDurationSec ?? 3600;

  const allCandidates: DiscoveredVideo[] = [];
  const queries = NICHE_SEARCH_QUERIES[config.niche] ?? NICHE_SEARCH_QUERIES["auto"];

  const rejectedSample: Array<{ title: string; platform: string; viewCount: number; reason: string }> = [];
  const MAX_REJECTED_SAMPLE = 10;

  log.log(`[DISCOVER] Niche "${config.niche}"`);

  // ── 1. YouTube search-based trending discovery ──
  log.log(`[SEARCH-YT] Running search for "${config.niche}"...`);
  const searchResults = await discoverViaSearch(config.niche, 10);
  let ytSearchCount = 0;
  for (const e of searchResults) {
    if (e.id) {
      ytSearchCount++;
      allCandidates.push({
        videoId: e.id, url: e.webpage_url || e.url || `https://www.youtube.com/watch?v=${e.id}`,
        title: e.title, channelId: e.channel_id, channelName: e.channel,
        viewCount: e.view_count, publishedAt: e.upload_date,
        durationSec: e.duration, platform: "youtube", source: "search",
      });
    }
  }
  log.log(`[SEARCH-YT] Got ${ytSearchCount} candidates`);

  // ── 2/3. Facebook + Instagram discovery ──
  let fbSearchCount = 0;
  let fbPageCount = 0;
  let igSearchCount = 0;
  let igProfileCount = 0;
  if (!hasCookieFile) {
    log.log("[DISCOVER] No cookies file detected; skipping Facebook/Instagram discovery and prioritizing reachable platforms (YouTube).");
  } else {
    const fbQuery = queries[0];
    const fbPages = NICHE_FB_PAGES[config.niche] ?? NICHE_FB_PAGES["auto"];

    // 2a. Try search first
    log.log(`[SEARCH-FB] Searching Facebook for "${fbQuery}"...`);
    try {
      const fbSearchResults = await searchFbVideos(fbQuery, 10);
      for (const v of fbSearchResults) {
        if (v.videoId) {
          fbSearchCount++;
          allCandidates.push({
            videoId: v.videoId, url: v.url, title: v.title,
            channelId: "", channelName: v.channelName,
            viewCount: v.viewCount, publishedAt: "",
            durationSec: v.durationSec, platform: "facebook", source: "search",
          });
        }
      }
      log.log(`[SEARCH-FB] Search returned ${fbSearchCount} videos`);
    } catch (err) {
      log.warn(`[SEARCH-FB] Search failed: ${err instanceof Error ? err.message : err}`);
    }

    // 2b. Scrape niche pages only as fallback (skip when search found enough)
    const FB_SEARCH_SUFFICIENT = 5;
    if (fbSearchCount < FB_SEARCH_SUFFICIENT) {
      const fbScrapeTargets: string[] = [];
      for (const pageUrl of fbPages) {
        fbScrapeTargets.push(pageUrl);
        const reelsUrl = pageUrl.replace(/\/videos\/?$/, "/reels/");
        if (reelsUrl !== pageUrl) fbScrapeTargets.push(reelsUrl);
      }

      log.log(`[SCRAPE-FB] Search found only ${fbSearchCount} (< ${FB_SEARCH_SUFFICIENT}), scraping ${fbScrapeTargets.length} page URLs as fallback...`);
      const limitedTargets = fbScrapeTargets.slice(0, FB_SCRAPE_TARGET_LIMIT);
      const fbScrapeResults = await Promise.allSettled(
        limitedTargets.map(async (url) => {
          log.log(`[SCRAPE-FB] Scraping ${url}...`);
          const videos = await discoverFbPageVideos(url, 15);
          log.log(`[SCRAPE-FB] Got ${videos.length} videos from ${url}`);
          return { url, videos };
        }),
      );
      for (const result of fbScrapeResults) {
        if (result.status === "rejected") {
          log.warn(`[SCRAPE-FB] Failed: ${result.reason}`);
          continue;
        }
        for (const v of result.value.videos) {
          if (v.videoId) {
            fbPageCount++;
            allCandidates.push({
              videoId: v.videoId, url: v.url, title: v.title,
              channelId: "", channelName: v.channelName,
              viewCount: v.viewCount, publishedAt: "",
              durationSec: v.durationSec, platform: "facebook", source: "search",
            });
          }
        }
      }
    } else {
      log.log(`[SCRAPE-FB] Skipping page scraping — search already found ${fbSearchCount} candidates (>= ${FB_SEARCH_SUFFICIENT})`);
    }
    log.log(`[FB-TOTAL] ${fbSearchCount + fbPageCount} raw (${fbSearchCount} search + ${fbPageCount} pages)`);

    // ── 3. Instagram discovery (search-first, profile scraping as fallback) ──
    const igSearchQueries = queries.map((q) => q.split(/\s+/)[0]).slice(0, 2);
    log.log(`[SEARCH-IG] Searching Instagram tags for "${config.niche}": ${igSearchQueries.join(", ")}...`);
    for (const igQuery of igSearchQueries) {
      try {
        const igSearchResults = await searchIgReels(igQuery, 10);
        for (const v of igSearchResults) {
          if (v.videoId) {
            igSearchCount++;
            allCandidates.push({
              videoId: v.videoId, url: v.url, title: v.title,
              channelId: "", channelName: v.channelName,
              viewCount: v.viewCount, publishedAt: "",
              durationSec: v.durationSec, platform: "instagram", source: "search",
            });
          }
        }
        log.log(`[SEARCH-IG] Tag #${igQuery} returned ${igSearchResults.length} reels`);
      } catch (err) {
        log.warn(`[SEARCH-IG] Tag search failed for #${igQuery}: ${err instanceof Error ? err.message : err}`);
      }
    }

    // 3b. Profile scraping only as fallback (skip when search found enough)
    const IG_SEARCH_SUFFICIENT = 5;
    const igProfiles = NICHE_IG_PROFILES[config.niche] ?? NICHE_IG_PROFILES["auto"];
    if (igSearchCount < IG_SEARCH_SUFFICIENT) {
      log.log(`[SCRAPE-IG] Search found only ${igSearchCount} (< ${IG_SEARCH_SUFFICIENT}), scraping ${igProfiles.length} profiles as fallback...`);
      const limitedProfiles = igProfiles.slice(0, IG_SCRAPE_TARGET_LIMIT);
      const igScrapeResults = await Promise.allSettled(
        limitedProfiles.map(async (profileUrl) => {
          log.log(`[SCRAPE-IG] Scraping ${profileUrl}...`);
          const reels = await discoverIgReels(profileUrl, 15);
          log.log(`[SCRAPE-IG] Got ${reels.length} reels from ${profileUrl}`);
          return { profileUrl, reels };
        }),
      );
      for (const result of igScrapeResults) {
        if (result.status === "rejected") {
          log.warn(`[SCRAPE-IG] Failed: ${result.reason}`);
          continue;
        }
        for (const v of result.value.reels) {
          if (v.videoId) {
            igProfileCount++;
            allCandidates.push({
              videoId: v.videoId, url: v.url, title: v.title,
              channelId: "", channelName: v.channelName,
              viewCount: v.viewCount, publishedAt: "",
              durationSec: v.durationSec, platform: "instagram", source: "search",
            });
          }
        }
      }
    } else {
      log.log(`[SCRAPE-IG] Skipping profile scraping — search already found ${igSearchCount} candidates (>= ${IG_SEARCH_SUFFICIENT})`);
    }
    log.log(`[IG-TOTAL] ${igSearchCount + igProfileCount} raw (${igSearchCount} search + ${igProfileCount} profiles)`);
  }


  // ── 4. YouTube Trending + Creative Commons (when API key available) ──
  if (ytApiKey) {
    const trendingIds = await fetchTrendingVideoIds(ytApiKey);
    for (const id of trendingIds) {
      allCandidates.push({
        videoId: id, url: `https://www.youtube.com/watch?v=${id}`,
        title: "", channelId: "", channelName: "",
        viewCount: 0, publishedAt: "", durationSec: 0,
        platform: "youtube", source: "trending",
      });
    }
    const ccIds = await searchCreativeCommons(ytApiKey);
    for (const id of ccIds) {
      allCandidates.push({
        videoId: id, url: `https://www.youtube.com/watch?v=${id}`,
        title: "", channelId: "", channelName: "",
        viewCount: 0, publishedAt: "", durationSec: 0,
        platform: "youtube", source: "creative-commons",
      });
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
    log.warn("No candidate videos found");
    return null;
  }

  const copyrightMap = new Map<string, CopyrightInfo>();

  // ── 5. Enrich YouTube candidates via API ──
  const needEnrich = unique.filter((v) => v.platform === "youtube" && !v.title);
  if (needEnrich.length > 0 && ytApiKey) {
    const details = await enrichYouTubeVideoDetails(needEnrich.map((v) => v.videoId), ytApiKey);
    for (const v of needEnrich) {
      const d = details.get(v.videoId);
      if (d) {
        v.title = d.title; v.viewCount = d.viewCount; v.durationSec = d.durationSec;
        v.channelId = d.channelId; v.channelName = d.channelName; v.publishedAt = d.publishedAt;
        v.likeCount = d.likeCount; v.commentCount = d.commentCount;
        v.licensedContent = d.licensedContent;
        copyrightMap.set(v.videoId, {
          licensedContent: d.licensedContent, license: "youtube",
          likeCount: d.likeCount, commentCount: d.commentCount,
        });
      }
    }
  }
  const stillNeedEnrich = unique.filter((v) => !v.title && v.url);
  if (stillNeedEnrich.length > 0) {
    log.log(`Enriching ${stillNeedEnrich.length} candidates via yt-dlp...`);
    for (const v of stillNeedEnrich.slice(0, 10)) {
      const entry = await resolveDirectUrl(v.url);
      if (entry) {
        v.title = entry.title || v.title; v.viewCount = entry.view_count || v.viewCount;
        v.durationSec = entry.duration || v.durationSec;
        v.channelName = entry.channel || v.channelName; v.channelId = entry.channel_id || v.channelId;
      }
    }
  }

  // ── 6. COPYRIGHT SCREEN (YouTube candidates only) ──
  const candidateIds = unique.filter((v) => v.platform === "youtube" && v.videoId).map((v) => v.videoId);
  if (ytApiKey && candidateIds.length > 0) {
    log.log(`[COPYRIGHT] Screening ${candidateIds.length} candidates...`);
    const crMap = await copyrightPreScreen(candidateIds, ytApiKey);
    for (const [id, info] of crMap) { copyrightMap.set(id, info); }
    const licensed = [...crMap.values()].filter((c) => c.licensedContent).length;
    const cc = [...crMap.values()].filter((c) => c.license === "creativeCommon").length;
    log.log(`[COPYRIGHT] ${licensed} licensed (risky), ${cc} Creative Commons (safe)`);
  }

  for (const v of unique) {
    const cr = copyrightMap.get(v.videoId);
    if (cr) {
      v.licensedContent = cr.licensedContent;
      v.likeCount = cr.likeCount;
      v.commentCount = cr.commentCount;
    }
  }

  // ── Filter + count (single source of truth — all counting happens here) ──
  const platformCounts: Record<string, { found: number; qualified: number; rejected: number }> = {};
  const filtered: DiscoveredVideo[] = [];

  function trackRejected(platform: string, title: string, viewCount: number, reason: string) {
    if (rejectedSample.length < MAX_REJECTED_SAMPLE) {
      rejectedSample.push({ title: title || "(untitled)", platform, viewCount, reason });
    }
  }

  // Count found per platform AFTER dedup
  for (const v of unique) {
    platformCounts[v.platform] = platformCounts[v.platform] ?? { found: 0, qualified: 0, rejected: 0 };
    platformCounts[v.platform].found++;
  }

  // Filter and count qualified/rejected — guaranteed: found = qualified + rejected
  for (const v of unique) {
    const pc = platformCounts[v.platform]!;
    const platformMin = v.platform === "instagram" ? igMinViews : v.platform === "facebook" ? fbMinViews : minViews;
    if (v.viewCount < platformMin) {
      pc.rejected++;
      trackRejected(v.platform, v.title, v.viewCount, `below ${platformMin.toLocaleString()} min views`);
      continue;
    }
    if (v.durationSec > 0 && v.durationSec < minDur) {
      pc.rejected++;
      trackRejected(v.platform, v.title, v.viewCount, `too short (${v.durationSec}s < ${minDur}s)`);
      continue;
    }
    if (v.durationSec > 0 && v.durationSec > maxDur) {
      pc.rejected++;
      trackRejected(v.platform, v.title, v.viewCount, `too long (${v.durationSec}s > ${maxDur}s)`);
      continue;
    }
    pc.qualified++;
    filtered.push(v);
  }

  for (const [plat, counts] of Object.entries(platformCounts)) {
    log.log(`[PLATFORM] ${plat}: ${counts.found} found → ${counts.qualified} qualified, ${counts.rejected} rejected`);
  }

  if (filtered.length === 0) {
    log.warn(`No videos passed filters (${unique.length} candidates, minViews=${minViews}, dur=${minDur}-${maxDur}s)`);
    return null;
  }

  // ── 7. QUALITY SCORING (0-100 scale) ──
  const scoredWithRank = filtered.map((v) => ({
    ...v,
    score: scoreCandidate(v, config.niche, copyrightMap),
  }));

  scoredWithRank.sort((a, b) => b.score - a.score);
  const best = scoredWithRank[0];

  const candidatesSummary = scoredWithRank.slice(0, 20).map((v) => ({
    title: v.title || "(untitled)",
    url: v.url,
    viewCount: v.viewCount,
    platform: v.platform,
    channelName: v.channelName || "(unknown)",
    score: v.score,
  }));

  log.log(`[RESULT] "${best.title}" (${best.viewCount.toLocaleString()} views, velocity=${Math.round(best.viewCount / 30)}/day, score=${best.score}, licensed=${best.licensedContent ?? "??"}) [${best.platform}/${best.source}] from ${unique.length} candidates`);
  return {
    selected: best,
    rankedCandidates: scoredWithRank.slice(0, 20).map(({ score, ...v }) => {
      void score;
      return v;
    }),
    candidates: candidatesSummary,
    totalConsidered: unique.length,
    platformBreakdown: platformCounts,
    rejectedSample,
  };
}
