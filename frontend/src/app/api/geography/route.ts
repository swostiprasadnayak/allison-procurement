import { getGeography } from "@/lib/cdm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ regions: await getGeography() });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
