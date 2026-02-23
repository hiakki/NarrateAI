import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ArrowLeft, Plus, Play, Clock, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";
import { DeleteButton } from "@/components/delete-button";

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle2; className: string }> = {
  QUEUED: { label: "Queued", icon: Clock, className: "text-yellow-600 bg-yellow-50" },
  GENERATING: { label: "Generating", icon: Loader2, className: "text-blue-600 bg-blue-50" },
  READY: { label: "Ready", icon: CheckCircle2, className: "text-green-600 bg-green-50" },
  SCHEDULED: { label: "Scheduled", icon: Clock, className: "text-purple-600 bg-purple-50" },
  POSTED: { label: "Posted", icon: CheckCircle2, className: "text-green-700 bg-green-100" },
  FAILED: { label: "Failed", icon: AlertCircle, className: "text-red-600 bg-red-50" },
};

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  const series = await db.series.findUnique({
    where: { id },
    include: {
      videos: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!series) notFound();
  if (series.userId !== session.user.id && session.user.role === "USER") {
    redirect("/dashboard/videos");
  }

  return (
    <div>
      <div className="flex items-center gap-4 mb-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/dashboard/videos">
            <ArrowLeft className="h-4 w-4 mr-1" /> Videos
          </Link>
        </Button>
      </div>

      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">{series.name}</h1>
          <div className="flex gap-3 mt-2 text-sm text-muted-foreground">
            <span className="capitalize">{series.niche}</span>
            <span>-</span>
            <span className="capitalize">{series.artStyle.replace("-", " ")}</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <DeleteButton
            endpoint={`/api/series/${series.id}`}
            label="Delete Series"
            description={`This will permanently delete "${series.name}" and all its ${series.videos.length} video${series.videos.length !== 1 ? "s" : ""}. This action cannot be undone.`}
            redirectTo="/dashboard/videos"
          />
          <Button asChild>
            <Link href="/dashboard/create">
              <Plus className="mr-2 h-4 w-4" /> New Video
            </Link>
          </Button>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-4">Videos</h2>

      {series.videos.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Play className="h-12 w-12 mb-4" />
            <p className="text-lg font-medium">No videos yet</p>
            <p className="text-sm mt-1">Your first video is being generated...</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {series.videos.map((video) => {
            const config = statusConfig[video.status] ?? statusConfig.QUEUED;
            const Icon = config.icon;
            return (
              <Card key={video.id} className="transition-colors hover:border-primary/50">
                <CardContent className="flex items-center justify-between p-4">
                  <Link href={`/dashboard/videos/${video.id}`} className="flex-1 min-w-0">
                    <h3 className="font-medium">
                      {video.title || "Untitled Video"}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      {new Date(video.createdAt).toLocaleDateString()}{" "}
                      {video.duration ? `- ${video.duration}s` : ""}
                    </p>
                  </Link>
                  <div className="flex items-center gap-3">
                    <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${config.className}`}>
                      <Icon key={video.status} className={`h-3 w-3 ${video.status === "GENERATING" ? "animate-spin" : ""}`} />
                      {config.label}
                      {video.status === "GENERATING" && video.generationStage && (
                        <span className="lowercase">({video.generationStage})</span>
                      )}
                    </div>
                    <DeleteButton
                      endpoint={`/api/videos/${video.id}`}
                      label="Delete Video"
                      description={`This will permanently delete "${video.title || "Untitled Video"}" and its generated output. This action cannot be undone.`}
                      redirectTo={`/dashboard/series/${series.id}`}
                      variant="icon"
                    />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
