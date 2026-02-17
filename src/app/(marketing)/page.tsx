import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-4">
      <div className="text-center">
        <h1 className="text-5xl font-bold tracking-tight">NarrateAI</h1>
        <p className="mt-4 text-lg text-muted-foreground max-w-md">
          Create viral faceless videos on auto-pilot. AI generates scripts,
          voiceovers, images, and posts for you.
        </p>
      </div>
      <div className="flex gap-4">
        <Button asChild size="lg">
          <Link href="/register">Get Started</Link>
        </Button>
        <Button asChild variant="outline" size="lg">
          <Link href="/login">Sign In</Link>
        </Button>
      </div>
    </div>
  );
}
