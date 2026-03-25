import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Film, Video, Bot, Share2, Sparkles, Scissors,
  ArrowRight, Clock, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  QUEUED:     { label: "Queued",     color: "bg-slate-100 text-slate-700 border-slate-200",   icon: Clock },
  GENERATING: { label: "Generating", color: "bg-blue-100 text-blue-700 border-blue-200",     icon: Loader2 },
  READY:      { label: "Ready",      color: "bg-amber-100 text-amber-700 border-amber-200",  icon: CheckCircle2 },
  SCHEDULED:  { label: "Scheduled",  color: "bg-purple-100 text-purple-700 border-purple-200", icon: Clock },
  POSTED:     { label: "Posted",     color: "bg-green-100 text-green-700 border-green-200",  icon: CheckCircle2 },
  FAILED:     { label: "Failed",     color: "bg-red-100 text-red-700 border-red-200",        icon: AlertCircle },
};

function relativeTime(date: Date): string {
  const ms = Date.now() - date.getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3600_000)}h ago`;
  const days = Math.floor(ms / 86_400_000);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const userId = session.user.id;
  const { name } = session.user;

  const [totalVideos, postedCount, activeAutos, channelCount, recentVideos] =
    await Promise.all([
      db.video.count({
        where: { series: { userId } },
      }),
      db.video.count({
        where: { series: { userId }, status: "POSTED" },
      }),
      db.automation.count({
        where: { userId, enabled: true },
      }),
      db.socialAccount.count({
        where: { userId },
      }),
      db.video.findMany({
        where: { series: { userId } },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          scheduledPostTime: true,
          series: { select: { name: true } },
        },
      }),
    ]);

  const stats = [
    { label: "Total Videos", value: totalVideos, icon: Film, color: "text-blue-600" },
    { label: "Posted", value: postedCount, icon: Video, color: "text-green-600" },
    { label: "Active Automations", value: activeAutos, icon: Bot, color: "text-purple-600" },
    { label: "Connected Channels", value: channelCount, icon: Share2, color: "text-orange-600" },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight truncate">
          Welcome back, {name ?? "there"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what&apos;s happening with your content.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-5 pb-4 px-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-medium text-muted-foreground">{s.label}</p>
                <s.icon className={`h-4 w-4 ${s.color}`} />
              </div>
              <p className="text-3xl font-bold tabular-nums">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Quick actions */}
      <div className="grid gap-4 md:grid-cols-2">
        <Link href="/dashboard/create" className="group block">
          <Card className="transition-all hover:border-primary/40 hover:shadow-sm">
            <CardContent className="flex items-center gap-4 py-5 px-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Sparkles className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold group-hover:text-primary transition-colors">
                  Create AI Video
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Generate a new video with AI scripts, voiceover, and visuals
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
            </CardContent>
          </Card>
        </Link>

        <Link href="/dashboard/clip-repurpose" className="group block">
          <Card className="transition-all hover:border-primary/40 hover:shadow-sm">
            <CardContent className="flex items-center gap-4 py-5 px-5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Scissors className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold group-hover:text-primary transition-colors">
                  Create Viral Clip
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Discover trending content and repurpose it into short clips
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary transition-colors shrink-0" />
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Recent videos */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Recent Videos</CardTitle>
            <Link
              href="/dashboard/videos"
              className="text-xs text-muted-foreground hover:text-primary transition-colors flex items-center gap-1"
            >
              View all <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentVideos.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              No videos yet. Create your first one above.
            </p>
          ) : (
            <div className="space-y-1">
              {recentVideos.map((v) => {
                const cfg = STATUS_CONFIG[v.status] ?? STATUS_CONFIG.QUEUED;
                return (
                  <Link
                    key={v.id}
                    href={`/dashboard/videos/${v.id}`}
                    className="flex items-center gap-3 rounded-md px-3 py-2.5 -mx-3 hover:bg-muted/50 transition-colors group"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate group-hover:text-primary transition-colors">
                        {v.title || v.series?.name || "(untitled)"}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        {relativeTime(v.createdAt)}
                        {v.series?.name ? ` · ${v.series.name}` : ""}
                      </p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${cfg.color}`}>
                      {cfg.label}
                    </Badge>
                  </Link>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
