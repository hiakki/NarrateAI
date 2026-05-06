import { db as prisma } from "@/lib/db";

async function main(): Promise<void> {
  const id = process.argv[2];
  if (!id) {
    console.error("Usage: tsx scripts/flow-tv-inspect-video.ts <videoId>");
    process.exit(2);
  }
  const v = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      status: true,
      scheduledPostTime: true,
      videoUrl: true,
      seriesId: true,
      duration: true,
      scheduledPlatforms: true,
      postedPlatforms: true,
      generationStage: true,
      series: { select: { id: true, name: true, niche: true } },
    },
  });
  console.log(JSON.stringify(v, null, 2));
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
