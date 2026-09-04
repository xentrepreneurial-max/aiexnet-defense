import { NextResponse } from "next/server";
import { ensurePollerRunning, getTracks, getFeedDiagnostics } from "@/lib/adsbStore";
import { ensureRecorderRunning } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Live air picture.
 *
 * Served entirely from real ADS-B position reports collected by the background
 * poller. When no upstream is reachable this returns an empty track list and
 * an OFFLINE link state — it does not synthesise aircraft.
 */
export async function GET() {
  ensurePollerRunning();
  ensureRecorderRunning();

  const tracks = getTracks();
  const diag = getFeedDiagnostics();

  const activeSource =
    diag.sources.find((s) => s.lastOkAgeSec !== null && s.lastOkAgeSec < 30)?.name ?? "NONE";

  return NextResponse.json(
    {
      success: diag.linkState !== "OFFLINE",
      status: {
        id: "AIR",
        linkState: diag.linkState,
        source: activeSource === "NONE" ? "NO UPSTREAM REACHABLE" : `ADS-B / ${activeSource}`,
        count: tracks.length,
        lastUpdateAgeSec: diag.lastSweepAgeSec,
        message:
          diag.linkState === "OFFLINE"
            ? "All ADS-B upstreams unreachable. No air picture available."
            : diag.linkState === "DEGRADED"
            ? "Upstream stalled — showing last known contacts, positions are ageing."
            : null,
      },
      diagnostics: diag,
      timestamp: new Date().toISOString(),
      count: tracks.length,
      data: tracks,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
