"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Film, Cookie, ArrowRight } from "lucide-react";

export default function FlowTvPage() {
  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <Film className="h-7 w-7" />
          Flow TV
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Generate short chained scene clips using Google Flow TV.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Setup Required</CardTitle>
          <CardDescription>
            Flow TV runs headless and needs your exported browser cookies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Upload Flow cookies in Settings first, then select `FLOW_TV` in your generation provider flow.
          </p>
          <Button asChild>
            <Link href="/dashboard/settings">
              <Cookie className="mr-2 h-4 w-4" />
              Open Settings
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
