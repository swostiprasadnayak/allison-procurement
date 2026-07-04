import { applyOpportunityAction } from "@/lib/cdm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Write a user decision onto an opportunity (opp.opportunity_action — the mutable
 * layer that survives engine reloads). Body: { id, action, ...payload }.
 * Actions: approve · park · reject · unpark · save · commit.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const id = String(body.id ?? "");
  const action = String(body.action ?? "");
  if (!id) return Response.json({ error: "missing id" }, { status: 400 });

  const patch = actionToPatch(action, body);
  if (!patch) return Response.json({ error: `unknown action: ${action}` }, { status: 400 });

  try {
    await applyOpportunityAction(id, patch);
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

function actionToPatch(
  action: string,
  body: Record<string, unknown>,
): Record<string, unknown> | null {
  const str = (v: unknown) => (v != null ? String(v) : null);
  const num = (v: unknown) => (v != null && v !== "" ? Number(v) : null);
  switch (action) {
    case "approve":
      return { status: "accepted" };
    case "park":
      return { status: "parked", park_trigger: str(body.trigger) };
    case "reject":
      return { status: "rejected", reject_reason: str(body.reason) };
    case "unpark":
      return { status: "qualified", park_trigger: null };
    case "stage":
      return { status: str(body.status) };
    case "save":
      // Every field is the caller's full current state (the store resolves
      // "unchanged" fallbacks before calling persistAction) — same contract
      // as approach/done_tasks already had.
      return {
        approach: str(body.approach),
        done_tasks: Array.isArray(body.doneTasks) ? body.doneTasks : [],
        custom_tasks: Array.isArray(body.customTasks) ? body.customTasks : [],
        draft_versions: Array.isArray(body.draftVersions) ? body.draftVersions : [],
      };
    case "commit":
      return {
        status: "committed",
        committed_at: str(body.committedAt),
        committed_timing: str(body.timing),
        committed_basis: str(body.basis),
        committed_low: num(body.low),
        committed_high: num(body.high),
      };
    default:
      return null;
  }
}
