import { getEngineParameters, updateEngineParameter } from "@/lib/cdm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getEngineParameters());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}

/** Persist an admin edit to a single parameter's value. Body:
 *  { key, valueNumeric?: number|null, valueJson?: string|null, note?: string }.
 *  Save-only — the engine applies the change on its next run. */
export async function PATCH(req: Request) {
  try {
    const body = (await req.json()) as {
      key?: string;
      valueNumeric?: number | null;
      valueJson?: string | null;
      note?: string;
    };
    if (!body.key) {
      return Response.json({ error: "missing param key" }, { status: 400 });
    }
    const valueNumeric =
      typeof body.valueNumeric === "number" && Number.isFinite(body.valueNumeric)
        ? body.valueNumeric
        : null;
    const valueJson = typeof body.valueJson === "string" ? body.valueJson : null;
    if (valueNumeric === null && valueJson === null) {
      return Response.json({ error: "no value provided" }, { status: 400 });
    }
    await updateEngineParameter({ key: body.key, valueNumeric, valueJson, note: body.note });
    return Response.json({ ok: true });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
