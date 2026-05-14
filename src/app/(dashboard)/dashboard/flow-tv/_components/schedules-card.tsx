// Flow TV — Daily Schedules card.
//
// Lets the user create / edit / delete / enable-toggle multiple Flow TV
// schedule rows. Each row is an Automation (automationType="flow-tv") with a
// full settings snapshot in flowTvConfig. The scheduler worker picks these
// up at BUILD_ALL_TIME each day and dispatches createRun() with the row's
// settings.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  CalendarClock,
  Plus,
  Trash2,
  Pencil,
  Save,
  X,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

// ─── types kept aligned with /api/dashboard/flow-tv/schedules ────────────────

const NICHES = [
  "zero-to-hero",
  "funny",
  "moral",
  "horror",
  "mythological",
] as const;
type Niche = (typeof NICHES)[number];

const LANGUAGES = ["hindi", "english"] as const;
type Language = (typeof LANGUAGES)[number];

const STYLES = ["cartoon_3d", "hyperreal_3d", "photoreal"] as const;
type Style = (typeof STYLES)[number];

const STYLE_LABELS: Record<Style, string> = {
  cartoon_3d: "Cartoon 3D",
  hyperreal_3d: "Hyperreal 3D",
  photoreal: "Photoreal",
};

type Source = "api" | "web";

const ASPECTS = ["9:16", "16:9"] as const;
type Aspect = (typeof ASPECTS)[number];

interface FlowTvConfig {
  imageCount: number;
  veoVariant: "Lite" | "Fast";
  language: Language;
  characterStyle: Style;
  aspectRatio: Aspect;
  dialogue: boolean;
  bgm: boolean;
  sfx: boolean;
  subtitles: boolean;
  useRecurringCharacter: boolean;
  storylineSource: Source;
  storyTitleHint?: string;
}

interface Schedule {
  id: string;
  name: string;
  niche: Niche;
  enabled: boolean;
  postTime: string;
  timezone: string;
  targetPlatforms: string[];
  lastRunAt: string | null;
  flowTvConfig: Partial<FlowTvConfig> | null;
  videoCount: number;
  lastVideo: {
    id: string;
    title: string | null;
    status: string;
    videoUrl: string | null;
    scheduledPostTime: string | null;
    createdAt: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface DraftSchedule {
  name: string;
  niche: Niche;
  enabled: boolean;
  postTime: string;
  timezone: string;
  flowTvConfig: FlowTvConfig;
}

const DEFAULT_DRAFT: DraftSchedule = {
  name: "",
  niche: "funny",
  enabled: true,
  postTime: "07:00",
  timezone: "Asia/Kolkata",
  flowTvConfig: {
    imageCount: 8,
    veoVariant: "Lite",
    language: "hindi",
    characterStyle: "cartoon_3d",
    aspectRatio: "9:16",
    dialogue: true,
    bgm: true,
    sfx: true,
    subtitles: false,
    useRecurringCharacter: false,
    storylineSource: "web",
    storyTitleHint: "",
  },
};

function summarizeConfig(s: Schedule): string {
  const c = s.flowTvConfig ?? {};
  const parts = [
    `${c.imageCount ?? 8} scenes`,
    c.language ?? "hindi",
    STYLE_LABELS[(c.characterStyle as Style) ?? "cartoon_3d"],
    c.aspectRatio ?? "9:16",
    `src=${c.storylineSource ?? "web"}`,
    `${c.dialogue ? "dialogue" : "-dialogue"}`,
    `${c.bgm ? "bgm" : "-bgm"}`,
    `${c.sfx ? "sfx" : "-sfx"}`,
    `${c.subtitles ? "subs" : "-subs"}`,
  ];
  return parts.join(" · ");
}

function fmt(s: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  return d.toLocaleString();
}

// ─── component ───────────────────────────────────────────────────────────────

export function FlowTvSchedulesCard() {
  const [items, setItems] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<DraftSchedule>(DEFAULT_DRAFT);
  const [createError, setCreateError] = useState("");
  const [creatingNow, setCreatingNow] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<DraftSchedule>(DEFAULT_DRAFT);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/flow-tv/schedules");
      if (!res.ok) return;
      const j = (await res.json()) as { data?: Schedule[] };
      setItems(j.data ?? []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const browserTz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
    } catch {
      return "Asia/Kolkata";
    }
  }, []);

  function startCreate() {
    setDraft({
      ...DEFAULT_DRAFT,
      timezone: browserTz,
      name: `Flow TV — ${DEFAULT_DRAFT.niche} ${DEFAULT_DRAFT.postTime}`,
    });
    setCreateError("");
    setCreating(true);
  }

  async function submitCreate() {
    setCreateError("");
    if (!draft.name.trim()) {
      setCreateError("Name is required.");
      return;
    }
    setCreatingNow(true);
    try {
      const res = await fetch("/api/dashboard/flow-tv/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setCreateError(j?.error ?? `Create failed (${res.status})`);
        return;
      }
      setCreating(false);
      setDraft(DEFAULT_DRAFT);
      await fetchAll();
    } finally {
      setCreatingNow(false);
    }
  }

  function startEdit(s: Schedule) {
    const c = (s.flowTvConfig ?? {}) as Partial<FlowTvConfig>;
    setEditDraft({
      name: s.name,
      niche: s.niche,
      enabled: s.enabled,
      postTime: s.postTime,
      timezone: s.timezone,
      flowTvConfig: { ...DEFAULT_DRAFT.flowTvConfig, ...c },
    });
    setEditingId(s.id);
  }

  async function submitEdit(id: string) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/dashboard/flow-tv/schedules/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.name,
          niche: editDraft.niche,
          postTime: editDraft.postTime,
          timezone: editDraft.timezone,
          enabled: editDraft.enabled,
          flowTvConfig: editDraft.flowTvConfig,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        await fetchAll();
      }
    } finally {
      setSavingId(null);
    }
  }

  async function toggleEnabled(s: Schedule, next: boolean) {
    setTogglingId(s.id);
    setItems((prev) =>
      prev.map((it) => (it.id === s.id ? { ...it, enabled: next } : it)),
    );
    try {
      const res = await fetch(`/api/dashboard/flow-tv/schedules/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) {
        // rollback
        setItems((prev) =>
          prev.map((it) => (it.id === s.id ? { ...it, enabled: !next } : it)),
        );
      }
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(id: string) {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/dashboard/flow-tv/schedules/${id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setItems((prev) => prev.filter((it) => it.id !== id));
      }
    } finally {
      setDeletingId(null);
    }
  }

  // ─── render ───────────────────────────────────────────────────────────────

  return (
    <Card className="border-zinc-200 dark:border-zinc-800">
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarClock className="h-5 w-5 text-blue-500" />
            Daily schedules
          </CardTitle>
          <CardDescription>
            Add one or more daily Flow TV runs. Each row fires at its own
            post-time with its own niche + settings. The scheduler skips
            any row whose toggle is off.
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setRefreshing(true);
              void fetchAll();
            }}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-1 h-4 w-4" />
            )}
            Refresh
          </Button>
          <Button size="sm" onClick={startCreate}>
            <Plus className="mr-1 h-4 w-4" /> Add schedule
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Create form (inline) */}
        {creating && (
          <Card className="border-blue-500/30 bg-blue-500/5">
            <CardContent className="space-y-3 p-4">
              <ScheduleEditor draft={draft} setDraft={setDraft} />
              {createError && (
                <p className="text-xs text-red-600">{createError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCreating(false)}
                  disabled={creatingNow}
                >
                  <X className="mr-1 h-3.5 w-3.5" /> Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={submitCreate}
                  disabled={creatingNow}
                >
                  {creatingNow ? (
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-1 h-4 w-4" />
                  )}
                  Save schedule
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* List */}
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading schedules…
          </div>
        ) : items.length === 0 && !creating ? (
          <div className="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-6 text-center">
            <Sparkles className="mx-auto h-6 w-6 text-zinc-400" />
            <p className="text-sm text-muted-foreground mt-2">
              No schedules yet. Click <span className="font-medium">Add schedule</span>
              {" "}to fire daily Flow TV runs automatically.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((s) => {
              const isEditing = editingId === s.id;
              return (
                <div
                  key={s.id}
                  className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-2"
                >
                  {isEditing ? (
                    <>
                      <ScheduleEditor draft={editDraft} setDraft={setEditDraft} />
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setEditingId(null)}
                          disabled={savingId === s.id}
                        >
                          <X className="mr-1 h-3.5 w-3.5" /> Cancel
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => submitEdit(s.id)}
                          disabled={savingId === s.id}
                        >
                          {savingId === s.id ? (
                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-1 h-4 w-4" />
                          )}
                          Save
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">
                            {s.name}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-600 border border-blue-500/20">
                            {s.niche}
                          </span>
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                            {s.postTime} · {s.timezone}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                          {summarizeConfig(s)}
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          Last run: {fmt(s.lastRunAt)} · Videos: {s.videoCount}
                          {s.lastVideo
                            ? ` · Last video: ${s.lastVideo.status}${s.lastVideo.title ? " — " + s.lastVideo.title : ""}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <div className="flex items-center gap-1.5">
                          <Switch
                            checked={s.enabled}
                            onCheckedChange={(v) => toggleEnabled(s, v)}
                            disabled={togglingId === s.id}
                          />
                          <span className="text-xs text-muted-foreground">
                            {s.enabled ? "Active" : "Paused"}
                          </span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2"
                          onClick={() => startEdit(s)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 px-2 border-red-300 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              disabled={deletingId === s.id}
                            >
                              {deletingId === s.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="h-3.5 w-3.5" />
                              )}
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>
                                Delete this schedule?
                              </AlertDialogTitle>
                              <AlertDialogDescription>
                                The schedule <strong>{s.name}</strong> will be
                                removed and its dedicated series deleted.
                                Already-generated videos under this schedule
                                stay in your library.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => remove(s.id)}
                                className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── inline schedule editor (shared by create + edit) ────────────────────────

function ScheduleEditor({
  draft,
  setDraft,
}: {
  draft: DraftSchedule;
  setDraft: (d: DraftSchedule) => void;
}) {
  const cfg = draft.flowTvConfig;

  function setCfg<K extends keyof FlowTvConfig>(key: K, value: FlowTvConfig[K]) {
    setDraft({ ...draft, flowTvConfig: { ...cfg, [key]: value } });
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Name</Label>
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Morning Funny @ 07:00"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Niche</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={draft.niche}
            onChange={(e) =>
              setDraft({ ...draft, niche: e.target.value as Niche })
            }
          >
            {NICHES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Post time (HH:MM, 24h)</Label>
          <Input
            value={draft.postTime}
            onChange={(e) =>
              setDraft({ ...draft, postTime: e.target.value.trim() })
            }
            placeholder="07:00"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Timezone</Label>
          <Input
            value={draft.timezone}
            onChange={(e) =>
              setDraft({ ...draft, timezone: e.target.value.trim() })
            }
            placeholder="Asia/Kolkata"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1">
        <div>
          <Label className="text-xs">Scenes (2–12)</Label>
          <Input
            type="number"
            min={2}
            max={12}
            value={cfg.imageCount}
            onChange={(e) =>
              setCfg("imageCount", Math.max(2, Math.min(12, Number(e.target.value) || 8)))
            }
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs">Veo</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={cfg.veoVariant}
            onChange={(e) =>
              setCfg("veoVariant", e.target.value as "Lite" | "Fast")
            }
          >
            <option value="Lite">Lite</option>
            <option value="Fast">Fast</option>
          </select>
        </div>
        <div>
          <Label className="text-xs">Aspect</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={cfg.aspectRatio}
            onChange={(e) => setCfg("aspectRatio", e.target.value as Aspect)}
          >
            {ASPECTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Language</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={cfg.language}
            onChange={(e) => setCfg("language", e.target.value as Language)}
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Character style</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={cfg.characterStyle}
            onChange={(e) => setCfg("characterStyle", e.target.value as Style)}
          >
            {STYLES.map((s) => (
              <option key={s} value={s}>
                {STYLE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-xs">Storyline source</Label>
          <select
            className="h-8 w-full rounded border border-zinc-300 dark:border-zinc-700 bg-transparent px-2 text-sm"
            value={cfg.storylineSource}
            onChange={(e) => setCfg("storylineSource", e.target.value as Source)}
          >
            <option value="web">Gemini 3 Fast (web)</option>
            <option value="api">Gemini API</option>
          </select>
        </div>
      </div>

      <div className="flex items-center gap-4 flex-wrap text-xs pt-1">
        <ToggleChip
          label="Dialogue"
          value={cfg.dialogue}
          onChange={(v) => setCfg("dialogue", v)}
        />
        <ToggleChip
          label="BGM"
          value={cfg.bgm}
          onChange={(v) => setCfg("bgm", v)}
        />
        <ToggleChip
          label="SFX"
          value={cfg.sfx}
          onChange={(v) => setCfg("sfx", v)}
        />
        <ToggleChip
          label="Subtitles"
          value={cfg.subtitles}
          onChange={(v) => setCfg("subtitles", v)}
        />
        <ToggleChip
          label="Recurring char"
          value={cfg.useRecurringCharacter}
          onChange={(v) => setCfg("useRecurringCharacter", v)}
        />
      </div>
    </>
  );
}

function ToggleChip({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="inline-flex items-center gap-1.5 cursor-pointer select-none">
      <Switch checked={value} onCheckedChange={onChange} />
      <span className="text-muted-foreground">{label}</span>
    </label>
  );
}
