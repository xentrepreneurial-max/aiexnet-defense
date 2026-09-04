import { NextRequest, NextResponse } from "next/server";
import { pictureAt, archiveStats } from "@/lib/archive";
import { ensureRecorderRunning } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Replay: the picture as it stood at a past instant.
 *
 * `at`     — ISO timestamp or epoch ms (defaults to now)
 * `window` — how stale a report may be and still count, in seconds
 *
 * Returns only positions that were actually reported. Nothing is interpolated
 * to fill a gap, so a sparse replay looks sparse — which is the truth.
 */
export async function GET(req: NextRequest) {
  ensureRecorderRunning();

  const url = req.nextUrl.searchParams;
  const rawAt = url.get("at");
  const windowSec = Math.min(3600, Math.max(30, Number(url.get("window") || 300)));

  let atMs = Date.now();
  if (rawAt) {
    const asNumber = Number(rawAt);
    atMs = Number.isFinite(asNumber) && rawAt.trim() !== "" ? asNumber : Date.parse(rawAt);
    if (!Number.isFinite(atMs)) {
      return NextResponse.json(
        { success: false, error: "`at` must be an ISO timestamp or epoch milliseconds." },
        { status: 400 }
      );
    }
  }

  const stats = archiveStats();
  const bounds = {
    earliest: Math.min(
      stats.air.earliest ?? Number.MAX_SAFE_INTEGER,
      stats.sea.earliest ?? Number.MAX_SAFE_INTEGER
    ),
    latest: Math.max(stats.air.latest ?? 0, stats.sea.latest ?? 0),
  };

  if (bounds.latest === 0) {
    return NextResponse.json(
      {
        success: false,
        status: {
          id: "REPLAY",
          linkState: "OFFLINE",
          source: "LOCAL ARCHIVE",
          count: 0,
          lastUpdateAgeSec: null,
          message:
            "Archive is empty. Recording begins as soon as a live feed reports — let it run, then scrub back.",
        },
        bounds: null,
        count: 0,
        data: { air: [], sea: [] },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  }

  const picture = pictureAt(atMs, windowSec);
  const total = picture.air.length + picture.sea.length;
  const outOfRange = atMs < bounds.earliest || atMs > bounds.latest + 60_000;

  return NextResponse.json(
    {
      success: true,
      status: {
        id: "REPLAY",
        linkState: total > 0 ? "LIVE" : "DEGRADED",
        source: "LOCAL ARCHIVE (recorded observations)",
        count: total,
        lastUpdateAgeSec: Math.round((Date.now() - atMs) / 1000),
        message: outOfRange
          ? "Requested instant is outside the recorded window."
          : total === 0
          ? "Nothing was recorded within the window around this instant."
          : null,
      },
      at: new Date(atMs).toISOString(),
      atMs,
      windowSec,
      bounds: {
        earliest: bounds.earliest,
        latest: bounds.latest,
        earliestIso: new Date(bounds.earliest).toISOString(),
        latestIso: new Date(bounds.latest).toISOString(),
      },
      count: total,
      data: picture,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
