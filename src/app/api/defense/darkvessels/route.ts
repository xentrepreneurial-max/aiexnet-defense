import { NextRequest, NextResponse } from "next/server";
import { detectAisGaps, detectReappearances } from "@/lib/darkVessels";
import { scanSar, correlateWithAis, sarConfigured } from "@/lib/sar";
import { ensureAisRunning, getVessels, getAisStatus } from "@/lib/aisStore";
import { pictureAt } from "@/lib/archive";
import { VesselData } from "@/types/intelligence";
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
        /**
         * Correlate against AIS as it was AT THE ACQUISITION, not now. A
         * Sentinel-1 pass can be days old; matching it to this minute's AIS
         * would label every ship in the image "dark" purely because it has
         * since sailed on.
         */
        const acqMs = scan.scene ? Date.parse(scan.scene.datetime) : NaN;
        let aisAtAcquisition: VesselData[] = getVessels();
        let aisCovered = false;
        let correlationNote: string | null = null;

        if (Number.isFinite(acqMs)) {
          const archived = pictureAt(acqMs, 1800).sea;
          if (archived.length > 0) {
            aisCovered = true;
            aisAtAcquisition = archived.map((r) => ({
              mmsi: r.id,
              name: r.description || `MMSI ${r.id}`,
              type: "OTHER" as const,
              flag: r.flag ?? "Unknown",
              latitude: r.latitude,
              longitude: r.longitude,
              speed: r.speed ?? 0,
              heading: r.track ?? 0,
              destination: "NOT RECORDED",
              status: "UNKNOWN" as const,
              threatLevel: "NORMAL" as const,
            }));
            correlationNote = `Correlated against ${archived.length} archived AIS report(s) within 30 minutes of the ${scan.scene?.datetime} acquisition.`;
          } else {
            correlationNote = `The archive holds no AIS for ${scan.scene?.datetime}, when this radar image was taken, so these targets cannot be judged. They are reported as UNCORRELATED, not dark. Once recording has been running across a Sentinel-1 pass, this box can be judged properly.`;
          }
        }

        const correlated = correlateWithAis(scan.targets, aisAtAcquisition, aisCovered);
        sar = {
          linkState: "LIVE",
          message: correlationNote,
          detections: correlated,
          meta: {
            raster: scan.raster,
            bbox: scan.bbox,
            timeRange: scan.timeRange,
            metresPerPixel: scan.metresPerPixel,
            waterFraction: scan.waterFraction,
            landMask: scan.landMask,
            warnings: scan.warnings,
            scene: scan.scene,
            aisCovered,
            targetCount: scan.targets.length,
            matchedCount: correlated.filter((c) => c.status === "MATCHED").length,
            darkCount: correlated.filter((c) => c.status === "DARK").length,
            uncorrelatedCount: correlated.filter((c) => c.status === "UNCORRELATED").length,
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
