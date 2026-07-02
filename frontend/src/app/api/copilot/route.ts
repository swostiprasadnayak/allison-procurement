// Proxies the FE to the Mercer copilot service (Python FastAPI, reuses the engine's copilot core
// + guardrails over the CDM). Keeps the LLM/grounding server-side; the browser only ever talks to
// this route. Body: { mode: "explain"|"ask"|"draft", ... } — forwarded to the matching endpoint.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COPILOT_URL = process.env.COPILOT_URL ?? "http://localhost:8000";

export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const mode = (body.mode as string) ?? "ask";
  const path = mode === "explain" ? "/explain" : mode === "draft" ? "/draft" : "/ask";

  try {
    const r = await fetch(`${COPILOT_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      // copilot calls can take a few seconds; don't let the platform cache them
      cache: "no-store",
    });
    const data = await r.json();
    return Response.json(data, { status: r.status });
  } catch (e) {
    // service down → a graceful, honest message the panel can render
    return Response.json(
      {
        text: "The Mercer copilot service isn't reachable. Start it with:\n  uvicorn services.copilot_api:app --port 8000",
        citations: [],
        staged_notes: [],
        guardrail: { passed: false, violations: ["copilot service unavailable"], warnings: [] },
        error: String(e),
      },
      { status: 503 },
    );
  }
}
