import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import {
  backfillFlowTvCharactersFromRuns,
  listFlowTvCharacters,
} from "@/services/flow-tv-character-library";

/**
 * List the caller's Flow TV characters (Character rows where `type` =
 * "flow_tv"), newest first. Used by the Flow TV dashboard's create-run UI to
 * render the "Reuse a character" thumbnail strip.
 *
 * Triggers a one-shot backfill from prior FlowRun state so users with
 * existing runs see their characters immediately (registerFlowTvCharacter is
 * idempotent so repeated calls are cheap).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    await backfillFlowTvCharactersFromRuns(session.user.id);
    const characters = await listFlowTvCharacters(session.user.id);
    return NextResponse.json({ data: characters });
  } catch (e) {
    return NextResponse.json(
      { error: (e as Error).message?.slice(0, 200) ?? "Failed to list" },
      { status: 500 },
    );
  }
}
