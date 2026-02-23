"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Bot, Plus, Clock, Loader2, Instagram, Youtube, Facebook,
  Trash2, Film,
} from "lucide-react";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Automation {
  id: string;
  name: string;
  niche: string;
  artStyle: string;
  tone: string;
  targetPlatforms: string[];
  enabled: boolean;
  frequency: string;
  postTime: string;
  timezone: string;
  lastRunAt: string | null;
  createdAt: string;
  series: { _count: { videos: number } } | null;
}

const PLATFORM_ICON: Record<string, typeof Instagram> = {
  INSTAGRAM: Instagram,
  YOUTUBE: Youtube,
  FACEBOOK: Facebook,
};

const FREQ_LABEL: Record<string, string> = {
  daily: "Daily",
  every_other_day: "Every other day",
  weekly: "Weekly",
};

export default function AutomationsPage() {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAutomations = useCallback(async () => {
    try {
      const res = await fetch("/api/automations");
      const json = await res.json();
      if (json.data) setAutomations(json.data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  async function toggleEnabled(id: string, enabled: boolean) {
    setAutomations((prev) =>
      prev.map((a) => (a.id === id ? { ...a, enabled } : a)),
    );
    try {
      await fetch(`/api/automations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setAutomations((prev) =>
        prev.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)),
      );
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/automations/${id}`, { method: "DELETE" });
      if (res.ok) setAutomations((prev) => prev.filter((a) => a.id !== id));
    } catch { /* ignore */ }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold">Automations</h1>
          <p className="mt-1 text-muted-foreground">
            Set up scheduled video generation and auto-posting to your channels.
          </p>
        </div>
        <Button asChild>
          <Link href="/dashboard/automations/new">
            <Plus className="mr-2 h-4 w-4" /> New Automation
          </Link>
        </Button>
      </div>

      {automations.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-16 text-muted-foreground">
            <Bot className="h-12 w-12 mb-4" />
            <h2 className="text-xl font-semibold text-foreground">No automations yet</h2>
            <p className="text-sm mt-2">
              Create an automation to auto-generate and post videos on a schedule.
            </p>
            <Button asChild className="mt-6">
              <Link href="/dashboard/automations/new">
                <Plus className="mr-2 h-4 w-4" /> Create your first automation
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {automations.map((auto) => (
            <Card key={auto.id} className="transition-colors hover:border-primary/50">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Link href={`/dashboard/automations/${auto.id}`} className="flex-1 min-w-0">
                    <CardTitle className="text-base truncate">{auto.name}</CardTitle>
                  </Link>
                  <Switch
                    checked={auto.enabled}
                    onCheckedChange={(v) => toggleEnabled(auto.id, v)}
                  />
                </div>
              </CardHeader>
              <Link href={`/dashboard/automations/${auto.id}`}>
                <CardContent className="pt-0 space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="secondary" className="capitalize text-xs">
                      {auto.niche}
                    </Badge>
                    <Badge variant="outline" className="capitalize text-xs">
                      {auto.tone}
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {auto.artStyle.replace(/-/g, " ")}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    <span>{FREQ_LABEL[auto.frequency] ?? auto.frequency} at {auto.postTime}</span>
                  </div>

                  {auto.targetPlatforms.length > 0 && (
                    <div className="flex items-center gap-2">
                      {auto.targetPlatforms.map((p) => {
                        const Icon = PLATFORM_ICON[p];
                        return Icon ? <Icon key={p} className="h-4 w-4 text-muted-foreground" /> : null;
                      })}
                    </div>
                  )}

                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Film className="h-3 w-3" />
                      {auto.series?._count.videos ?? 0} videos
                    </span>
                    <span>
                      {auto.lastRunAt
                        ? `Last run: ${new Date(auto.lastRunAt).toLocaleDateString()}`
                        : "Never run"}
                    </span>
                  </div>
                </CardContent>
              </Link>
              <div className="px-6 pb-4 flex justify-end">
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="ghost" size="icon-xs" className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete automation?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This will permanently delete &quot;{auto.name}&quot; and all its generated videos.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleDelete(auto.id)}
                        className="bg-destructive text-white hover:bg-destructive/90"
                      >
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
