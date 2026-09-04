import { NextResponse } from "next/server";
import { ensureAisRunning, getVessels, getAisStatus } from "@/lib/aisStore";
import { ensureRecorderRunning } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Live maritime picture from AIS.
 *
 * Returns only vessels that actually broadcast a position report. When the
 * AIS feed is not configured or is down, the vessel list is empty and the
 * status block says why.
 */
export async function GET() {
  ensureAisRunning();
  ensureRecorderRunning();
  const vessels = getVessels();
  const status = getAisStatus();

  return NextResponse.json(
    {
      success: status.linkState === "LIVE" || status.linkState === "DEGRADED",
      status,
      timestamp: new Date().toISOString(),
      count: vessels.length,
      data: vessels,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
