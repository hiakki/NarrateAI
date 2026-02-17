import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, Film, Clock, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import Link from "next/link";

const videoStatusDisplay: Record<string, { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "text-yellow-600 bg-yellow-50" },
  GENERATING: { label: "Generating", className: "text-blue-600 bg-blue-50" },
  READY: { label: "Ready", className: "text-green-600 bg-green-50" },
  SCHEDULED: { label: "Scheduled", className: "text-purple-600 bg-purple-50" },
  POSTED: { label: "Posted", className: "text-green-700 bg-green-100" },
  FAILED: { label: "Failed", className: "text-red-600 bg-red-50" },
};

export default async function SeriesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const series = await db.series.findMany({
    where: { userId: session.user.id },
    include: {
      _count: { select: { videos: true } },
      videos: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { status: true, generationStage: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Series</h1>
          <p className="mt-1 text-muted-foreground">
            Manage your video series and generate new content.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/series/new">
            <Plus className="mr-2 h-4 w-4" />
            New Series
          </Link>
        </Button>
      </div>

      {series.length === 0 ? (
        <Card className="mt-8">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Film className="h-12 w-12 text-muted-foreground" />
            <h2 className="mt-4 text-xl font-semibold">No series yet</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Create your first series to start generating AI videos.
            </p>
            <Button asChild className="mt-6">
              <Link href="/dashboard/series/new">
                <Plus className="mr-2 h-4 w-4" />
                Create your first series
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {series.map((s) => {
            const latestVideo = s.videos[0];
            const videoStatus = latestVideo
              ? videoStatusDisplay[latestVideo.status] ?? videoStatusDisplay.QUEUED
              : null;

            return (
              <Link key={s.id} href={`/dashboard/series/${s.id}`}>
                <Card className="transition-colors hover:border-primary/50">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-lg">{s.name}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between text-sm text-muted-foreground">
                      <span className="capitalize">{s.niche}</span>
                      <span>{s._count.videos} video{s._count.videos !== 1 ? "s" : ""}</span>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs capitalize">
                        {s.artStyle.replace(/-/g, " ")}
                      </span>
                      {videoStatus && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${videoStatus.className}`}>
                          {videoStatus.label}
                          {latestVideo?.status === "GENERATING" && latestVideo.generationStage && (
                            <span className="lowercase ml-1">({latestVideo.generationStage.toLowerCase()})</span>
                          )}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
