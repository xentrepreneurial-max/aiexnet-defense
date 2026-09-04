import { NextResponse } from "next/server";
import { ensurePollerRunning, getFeedDiagnostics } from "@/lib/adsbStore";
import { ensureAisRunning, getAisStatus } from "@/lib/aisStore";
import { tleCacheStatus, refreshTles } from "@/lib/tle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** One place to see whether every intelligence feed is actually alive. */
export async function GET() {
  ensurePollerRunning();
  ensureAisRunning();

  // Element sets are cached for six hours, so this is a no-op after the first
  // call. Without it a fresh server reported SPACE as OFFLINE until something
  // else happened to touch the satellite route, which lit a red HUD light for
  // a feed that was perfectly healthy.
  await refreshTles();

  const air = getFeedDiagnostics();
  const sea = getAisStatus();
  const space = tleCacheStatus();

  const configured = {
    AISSTREAM_API_KEY: Boolean(process.env.AISSTREAM_API_KEY),
    NASA_FIRMS_MAP_KEY: Boolean(process.env.NASA_FIRMS_MAP_KEY),
  };

  return NextResponse.json(
    {
      timestamp: new Date().toISOString(),
      feeds: {
        air: {
          linkState: air.linkState,
          trackCount: air.trackCount,
          cycleLengthSec: air.cycleLengthSec,
          lastSweepAgeSec: air.lastSweepAgeSec,
          coverage: air.coverage,
          militaryTracksLastSweep: air.militaryTracksLastSweep,
          lastMilSweepAgeSec: air.lastMilSweepAgeSec,
          sources: air.sources,
        },
        sea: {
          linkState: sea.linkState,
          vesselCount: sea.count,
          lastUpdateAgeSec: sea.lastUpdateAgeSec,
          message: sea.message,
          diagnostics: sea.diagnostics,
        },
        space: {
          linkState: space.count > 0 ? "LIVE" : "OFFLINE",
          elementSets: space.count,
          lastRefreshAgeSec: space.lastRefreshAgeSec,
          lastError: space.lastError,
        },
        thermal: {
          linkState: configured.NASA_FIRMS_MAP_KEY ? "CONFIGURED" : "NO_KEY",
        },
      },
      configured,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
