import { NextRequest, NextResponse } from "next/server";
import { detectAisGaps, detectReappearances } from "@/lib/darkVessels";
import { scanSar, correlateWithAis, sarConfigured } from "@/lib/sar";
import { ensureAisRunning, getVessels, getAisStatus } from "@/lib/aisStore";
import { ensureRecorderRunning } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Dark-vessel analysis.
 *
 * Always runs AIS gap analysis over the local archive — that needs no key.
 * Runs a Sentinel-1 SAR sweep as well when `bbox` is supplied and Copernicus
 * credentials are configured, because radar sees hulls that AIS does not
 * report.
 *
 * Query parameters:
 *   bbox=minLon,minLat,maxLon,maxLat   run a SAR sweep over this box
 *   hours=24                            SAR acquisition lookback
 *   size=1024                           SAR raster size in pixels
 */
export async function GET(req: NextRequest) {
  ensureAisRunning();
  ensureRecorderRunning();

  const p = req.nextUrl.searchParams;
  const aisStatus = getAisStatus();

  let gaps: ReturnType<typeof detectAisGaps> = [];
  let reappearances: ReturnType<typeof detectReappearances> = [];
  let archiveError: string | null = null;

  try {
    gaps = detectAisGaps({
      minGapMinutes: Number(p.get("minGap") || 20),
      maxGapHours: Number(p.get("maxGap") || 12),
    });
    reappearances = detectReappearances({});
  } catch (err: any) {
    archiveError = String(err?.message ?? err);
  }

  // --- Optional SAR sweep ---------------------------------------------------
  const bboxRaw = p.get("bbox");
  let sar: {
    linkState: "LIVE" | "OFFLINE" | "NO_KEY" | "NOT_REQUESTED";
    message: string | null;
    detections: unknown[];
    meta: unknown | null;
  } = {
    linkState: "NOT_REQUESTED",
    message:
      "Pass bbox=minLon,minLat,maxLon,maxLat to sweep Sentinel-1 radar over an area.",
    detections: [],
    meta: null,
  };

  if (bboxRaw) {
    if (!sarConfigured()) {
      sar = {
        linkState: "NO_KEY",
        message:
          "Sentinel-1 not configured. Create free Copernicus Data Space credentials at dataspace.copernicus.eu and set CDSE_CLIENT_ID and CDSE_CLIENT_SECRET.",
        detections: [],
        meta: null,
      };
    } else {
      const parts = bboxRaw.split(",").map(Number);
      if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
        return NextResponse.json(
          { success: false, error: "bbox must be minLon,minLat,maxLon,maxLat" },
          { status: 400 }
        );
      }
      const [minLon, minLat, maxLon, maxLat] = parts;
      if (maxLon <= minLon || maxLat <= minLat) {
        return NextResponse.json(
          { success: false, error: "bbox max values must exceed min values" },
          { status: 400 }
        );
      }

      try {
        const scan = await scanSar({
          bbox: [minLon, minLat, maxLon, maxLat],
          lookbackHours: Math.min(240, Math.max(1, Number(p.get("hours") || 24))),
          size: Math.min(2048, Math.max(256, Number(p.get("size") || 1024))),
        });
        const correlated = correlateWithAis(scan.targets, getVessels());
        sar = {
          linkState: "LIVE",
          message:
            aisStatus.linkState === "NO_KEY"
              ? "Radar targets found, but AIS is not configured — nothing to correlate against, so every target reads as unmatched."
              : null,
          detections: correlated,
          meta: {
            raster: scan.raster,
            bbox: scan.bbox,
            timeRange: scan.timeRange,
            metresPerPixel: scan.metresPerPixel,
            targetCount: scan.targets.length,
            darkCount: correlated.filter((c) => c.dark).length,
          },
        };
      } catch (err: any) {
        sar = {
          linkState: "OFFLINE",
          message: `Sentinel-1 sweep failed: ${err?.message ?? err}`,
          detections: [],
          meta: null,
        };
      }
    }
  }

  return NextResponse.json(
    {
      success: true,
      status: {
        id: "DARK_VESSELS",
        linkState: aisStatus.linkState === "NO_KEY" ? "NO_KEY" : "LIVE",
        source: "AIS gap analysis (local archive) + Sentinel-1 SAR",
        count: gaps.length + (sar.detections as unknown[]).length,
        lastUpdateAgeSec: 0,
        message:
          aisStatus.linkState === "NO_KEY"
            ? "AIS is not configured, so there is no reporting history to find gaps in. Set AISSTREAM_API_KEY."
            : archiveError,
      },
      aisGaps: {
        count: gaps.length,
        note:
          "A gap means a vessel stopped reporting while under way. It is a cue to investigate, not evidence of intent.",
        data: gaps,
      },
      reappearances: {
        count: reappearances.length,
        data: reappearances.slice(0, 50),
      },
      sar,
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
