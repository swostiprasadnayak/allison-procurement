import { getPlaybooks } from "@/lib/cdm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await getPlaybooks());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
