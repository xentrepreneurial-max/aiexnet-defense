import { NextResponse } from "next/server";
import * as satellite from "satellite.js";
import { SatelliteData } from "@/types/intelligence";
import {
  SATELLITE_CATALOG,
  getTle,
  refreshTles,
  tleCacheStatus,
  tleEpochDate,
} from "@/lib/tle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Area of interest used for overhead / next-pass calculations. */
const AOI = { latDeg: 23.685, lonDeg: 90.3563, heightKm: 0.01, name: "BANGLADESH AOI" };

const EARTH_RADIUS_KM = 6371.0;
const RAD_TO_DEG = 180 / Math.PI;

/** True ground footprint radius for a satellite at altitude h, 0° elevation. */
function footprintRadiusKm(altitudeKm: number): number {
  const ratio = EARTH_RADIUS_KM / (EARTH_RADIUS_KM + altitudeKm);
  if (ratio >= 1) return 0;
  return Math.round(EARTH_RADIUS_KM * Math.acos(ratio));
}

interface Propagated {
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
  elevationDeg: number;
}

function propagateAt(satrec: satellite.SatRec, when: Date): Propagated | null {
  const pv = satellite.propagate(satrec, when);
  const posEci = pv?.position;
  if (!posEci || typeof posEci === "boolean") return null;

  const gmst = satellite.gstime(when);
  const gd = satellite.eciToGeodetic(posEci, gmst);

  let speedKmS = 0;
  const velEci = pv.velocity;
  if (velEci && typeof velEci !== "boolean") {
    speedKmS = Math.sqrt(velEci.x ** 2 + velEci.y ** 2 + velEci.z ** 2);
  }

  const observerGd = {
    longitude: satellite.degreesToRadians(AOI.lonDeg),
    latitude: satellite.degreesToRadians(AOI.latDeg),
    height: AOI.heightKm,
  };
  const posEcf = satellite.eciToEcf(posEci, gmst);
  const look = satellite.ecfToLookAngles(observerGd, posEcf);

  return {
    latDeg: satellite.degreesLat(gd.latitude),
    lonDeg: satellite.degreesLong(gd.longitude),
    altKm: gd.height,
    speedKmS,
    elevationDeg: look.elevation * RAD_TO_DEG,
  };
}

/**
 * Next time the satellite rises above 10° elevation over the AOI.
 * Coarse 30 s scan across the next 24 h; returns null if it never rises
 * (which is the correct answer for a geostationary satellite out of view).
 */
function nextPass(satrec: satellite.SatRec, from: Date): number | null {
  const stepSec = 30;
  const horizonHours = 24;
  let wasVisible: boolean | null = null;
  for (let s = 0; s <= horizonHours * 3600; s += stepSec) {
    const when = new Date(from.getTime() + s * 1000);
    const p = propagateAt(satrec, when);
    if (!p) continue;
    const visible = p.elevationDeg > 10;
    if (wasVisible === false && visible) return when.getTime();
    if (s === 0 && visible) return from.getTime(); // already overhead
    wasVisible = visible;
  }
  return null;
}

export async function GET() {
  const now = new Date();

  await refreshTles();
  const cacheStatus = tleCacheStatus();

  const results: SatelliteData[] = [];
  const missing: string[] = [];

  for (const entry of SATELLITE_CATALOG) {
    const tle = getTle(entry.noradId);
    if (!tle) {
      // No element set published for this object right now. We report the
      // gap rather than inventing an orbit for it.
      missing.push(entry.displayName);
      continue;
    }

    let satrec: satellite.SatRec;
    try {
      satrec = satellite.twoline2satrec(tle.line1, tle.line2);
    } catch {
      missing.push(entry.displayName);
      continue;
    }
    if (satrec.error && satrec.error !== 0) {
      missing.push(entry.displayName);
      continue;
    }

    const current = propagateAt(satrec, now);
    if (!current) {
      missing.push(entry.displayName);
      continue;
    }

    // Ground track: one full revolution centred on now.
    const meanMotionRevPerDay = (satrec.no * 1440) / (2 * Math.PI);
    const periodMinutes = meanMotionRevPerDay > 0 ? 1440 / meanMotionRevPerDay : 1436;
    const halfSpanMin = Math.min(periodMinutes / 2, 60);
    const orbitPath: [number, number][] = [];
    const steps = 90;
    for (let i = 0; i <= steps; i++) {
      const offsetMin = -halfSpanMin + (2 * halfSpanMin * i) / steps;
      const p = propagateAt(satrec, new Date(now.getTime() + offsetMin * 60_000));
      if (p) orbitPath.push([Number(p.lonDeg.toFixed(4)), Number(p.latDeg.toFixed(4))]);
    }

    const epoch = tleEpochDate(tle.line1);
    const tleAgeDays = (now.getTime() - epoch.getTime()) / 86_400_000;
    const inclinationDeg = satrec.inclo * RAD_TO_DEG;

    results.push({
      id: entry.id,
      name: entry.displayName,
      noradId: entry.noradId,
      type: entry.type,
      operator: entry.operator,
      latitude: Number(current.latDeg.toFixed(4)),
      longitude: Number(current.lonDeg.toFixed(4)),
      altitude: Math.round(current.altKm),
      velocity: Number(current.speedKmS.toFixed(2)),
      footprintRadiusKm: footprintRadiusKm(current.altKm),
      orbitPath: orbitPath.length > 1 ? orbitPath : [[current.lonDeg, current.latDeg]],
      tleLine1: tle.line1,
      tleLine2: tle.line2,
      tleEpoch: epoch.toISOString(),
      tleAgeDays: Number(tleAgeDays.toFixed(2)),
      overheadAoi: current.elevationDeg > 10,
      nextPassTime: current.elevationDeg > 10 ? now.getTime() : nextPass(satrec, now),
      inclinationDeg: Number(inclinationDeg.toFixed(3)),
      periodMinutes: Number(periodMinutes.toFixed(2)),
    });
  }

  const linkState =
    results.length === 0 ? "OFFLINE" : missing.length > 0 ? "DEGRADED" : "LIVE";

  return NextResponse.json(
    {
      success: results.length > 0,
      status: {
        id: "SPACE",
        linkState,
        source: "CelesTrak GP (US Space Force catalogue) + SGP4",
        count: results.length,
        lastUpdateAgeSec: cacheStatus.lastRefreshAgeSec,
        message:
          results.length === 0
            ? "CelesTrak unreachable — no element sets cached."
            : missing.length > 0
            ? `No published element set for: ${missing.join(", ")}`
            : null,
      },
      aoi: AOI,
      timestamp: now.toISOString(),
      count: results.length,
      data: results,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
