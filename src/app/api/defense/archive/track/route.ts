import { NextRequest, NextResponse } from "next/server";
import { contactHistory } from "@/lib/archive";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Complete observed history of one contact (ICAO24 hex or MMSI). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const id = (p.get("id") || "").trim().toLowerCase();
  if (!id) {
    return NextResponse.json(
      { success: false, error: "`id` is required (ICAO24 hex or MMSI)." },
      { status: 400 }
    );
  }

  const to = Number(p.get("to") || Date.now());
  const from = Number(p.get("from") || to - 24 * 3600 * 1000);

  const result = contactHistory(id, from, to);
  if (!result) {
    return NextResponse.json(
      { success: false, error: `No contact recorded with id ${id}.` },
      { status: 404 }
    );
  }

  return NextResponse.json(
    {
      success: true,
      id,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
      meta: result.meta,
      count: result.positions.length,
      positions: result.positions,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
