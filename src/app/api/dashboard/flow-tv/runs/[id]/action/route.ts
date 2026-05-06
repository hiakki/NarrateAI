// Single dispatcher for all per-run actions on the run-machine.
//
// Body: { action: string, ...args }
//
// Actions:
//   storyline.refresh                  — re-roll storyline at gate
//   storyline.edit  { title?, logline?, characterPrompt? }
//   storyline.approve                  — approve & advance
//   images.refresh  { kind, index }    — refresh one Phase-1 asset (queued)
//   images.approve                     — approve & advance to clips
//   clips.refresh   { index }          — refresh one Phase-2 clip (queued)
//   clips.approve                      — approve & advance to finalize
//   cancel          { reason? }
//   retry                              — recover a failed run from last in-flight stage
//
// "Refresh" actions for assets/clips are queued via BullMQ (since they need
// the browser); the API returns immediately with 202. The run state machine
// transitions itself when the worker finishes.
//
// "Approve" and "edit" actions are synchronous (they don't need the browser).
// Approve enqueues a follow-up advance job for the next stages.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { z } from "zod/v4";
import {
  loadRun,
  refreshStoryline,
  editStoryline,
  approveStoryline,
  approveImages,
  approveClips,
  cancelRun,
  retryRun,
} from "@/services/flow-tv-run";
import {
  enqueueFlowTvAdvance,
  enqueueFlowTvRefreshImage,
  enqueueFlowTvRefreshClip,
} from "@/services/queue";

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("storyline.refresh") }),
  z.object({
    action: z.literal("storyline.edit"),
    title: z.string().optional(),
    logline: z.string().optional(),
    characterPrompt: z.string().optional(),
  }),
  z.object({ action: z.literal("storyline.approve") }),
  z.object({
    action: z.literal("images.refresh"),
    kind: z.enum(["character", "image"]),
    index: z.number().int().min(1),
  }),
  z.object({ action: z.literal("images.approve") }),
  z.object({
    action: z.literal("clips.refresh"),
    index: z.number().int().min(1),
  }),
  z.object({ action: z.literal("clips.approve") }),
  z.object({
    action: z.literal("cancel"),
    reason: z.string().optional(),
  }),
  z.object({ action: z.literal("retry") }),
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const run = await loadRun(id);
  if (!run) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (run.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }
  const action = parsed.data;

  try {
    switch (action.action) {
      case "storyline.refresh": {
        const updated = await refreshStoryline(id);
        return NextResponse.json({ data: updated });
      }
      case "storyline.edit": {
        const updated = await editStoryline(id, {
          title: action.title,
          logline: action.logline,
          characterPrompt: action.characterPrompt,
        });
        return NextResponse.json({ data: updated });
      }
      case "storyline.approve": {
        // approveStoryline transitions the stage and itself enqueues; we
        // also re-enqueue an advance to be safe (idempotent).
        const updated = await approveStoryline(id);
        await enqueueFlowTvAdvance(id);
        return NextResponse.json({ data: updated });
      }
      case "images.refresh": {
        await enqueueFlowTvRefreshImage({
          runId: id,
          assetKind: action.kind,
          index: action.index,
        });
        return NextResponse.json(
          { data: { queued: true, kind: action.kind, index: action.index } },
          { status: 202 },
        );
      }
      case "images.approve": {
        const updated = await approveImages(id);
        await enqueueFlowTvAdvance(id);
        return NextResponse.json({ data: updated });
      }
      case "clips.refresh": {
        await enqueueFlowTvRefreshClip({ runId: id, index: action.index });
        return NextResponse.json(
          { data: { queued: true, index: action.index } },
          { status: 202 },
        );
      }
      case "clips.approve": {
        const updated = await approveClips(id);
        await enqueueFlowTvAdvance(id);
        return NextResponse.json({ data: updated });
      }
      case "cancel": {
        const updated = await cancelRun(id, action.reason);
        return NextResponse.json({ data: updated });
      }
      case "retry": {
        const updated = await retryRun(id);
        await enqueueFlowTvAdvance(id);
        return NextResponse.json({ data: updated });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
