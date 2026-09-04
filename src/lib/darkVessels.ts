/**
 * Dark-vessel analysis.
 *
 * Two independent methods, because each catches what the other misses:
 *
 * 1. AIS GAP ANALYSIS — needs no extra data source, only our own recording.
 *    A vessel that was under way and reporting, then stopped while still
 *    inside our receiving area, has either left coverage or switched its
 *    transponder off. We report the gap and where dead reckoning says it
 *    should be, and we say plainly that a gap is not proof of intent.
 *
 * 2. SAR CORRELATION — Sentinel-1 sees hulls regardless of what they
 *    broadcast. A radar target with no AIS vessel near it is a vessel
 *    operating without AIS. This is the stronger signal, and it needs
 *    Copernicus credentials.
 */

import { getDb } from "./archive";
import { projectPosition, haversineKm } from "./airspace";
import { describeSector } from "./regions";

export interface AisGap {
  mmsi: string;
  name: string | null;
  flag: string | null;
  category: string | null;
  /** Last position actually reported. */
  lastLat: number;
  lastLon: number;
  lastSog: number | null;
  lastCog: number | null;
  lastReport: number;
  gapMinutes: number;
  /** Where the vessel would be if it held its last course and speed. */
  predictedLat: number;
  predictedLon: number;
  /** How far dead reckoning has carried it since the last report. */
  predictedDriftKm: number;
  sector: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  note: string;
}

/** A vessel that went quiet and later reappeared somewhere it could not have
 *  reached at its reported speed, or reappeared after a long silence. */
export interface ReappearanceEvent {
  mmsi: string;
  name: string | null;
  gapMinutes: number;
  fromLat: number;
  fromLon: number;
  toLat: number;
  toLon: number;
  jumpKm: number;
  /** Speed the jump implies, in knots. */
  impliedSpeedKts: number;
  lastReportedSog: number | null;
  sector: string;
  note: string;
}

/** Vessels that stopped reporting while under way. */
export function detectAisGaps(options?: {
  minGapMinutes?: number;
  maxGapHours?: number;
  minSpeedKts?: number;
}): AisGap[] {
  const minGapMinutes = options?.minGapMinutes ?? 20;
  const maxGapHours = options?.maxGapHours ?? 12;
  const minSpeedKts = options?.minSpeedKts ?? 1.0;

  const db = getDb();
  const now = Date.now();
  const oldest = now - maxGapHours * 3600_000;
  const newest = now - minGapMinutes * 60_000;

  const rows = db
    .prepare(
      `SELECT p.mmsi, p.ts, p.lat, p.lon, p.sog, p.cog, p.status,
              c.description AS name, c.flag, c.category
         FROM sea_position p
         JOIN (SELECT mmsi, MAX(ts) AS mts FROM sea_position GROUP BY mmsi) last
           ON last.mmsi = p.mmsi AND last.mts = p.ts
    LEFT JOIN contact c ON c.id = p.mmsi
        WHERE p.ts BETWEEN ? AND ?
          AND p.sog >= ?`
    )
    .all(oldest, newest, minSpeedKts) as any[];

  return rows.map((r) => {
    const gapMs = now - r.ts;
    const gapMinutes = Math.round(gapMs / 60_000);
    const sog = Number(r.sog ?? 0);
    const cog = Number(r.cog ?? 0);

    // Dead reckon from the last observation. Knots to km: 1 kt = 1.852 km/h.
    const driftKm = (sog * 1.852 * gapMs) / 3_600_000;
    const predicted = projectPosition(r.lat, r.lon, cog, driftKm);

    // A Class A transponder on a moving vessel reports every few seconds.
    // Half an hour of silence from a vessel that was under way is already
    // worth a look; two hours is a serious gap.
    let severity: AisGap["severity"] = "LOW";
    if (gapMinutes >= 120) severity = "HIGH";
    else if (gapMinutes >= 30) severity = "MEDIUM";

    return {
      mmsi: r.mmsi,
      name: r.name ?? null,
      flag: r.flag ?? null,
      category: r.category ?? null,
      lastLat: r.lat,
      lastLon: r.lon,
      lastSog: sog,
      lastCog: cog,
      lastReport: r.ts,
      gapMinutes,
      predictedLat: Number(predicted.lat.toFixed(5)),
      predictedLon: Number(predicted.lon.toFixed(5)),
      predictedDriftKm: Number(driftKm.toFixed(1)),
      sector: describeSector(r.lat, r.lon),
      severity,
      note:
        "An AIS gap is not proof of concealment: the vessel may simply have left receiver coverage, or its transponder may have failed. Treat this as a cue to look, not a conclusion.",
    };
  });
}

/**
 * Vessels that reappeared after a silence, with the implied speed of the jump.
 *
 * An implied speed far above what the vessel reported is the interesting case:
 * either it was moving faster than it declared, or it was somewhere else
 * entirely while dark.
 */
export function detectReappearances(options?: {
  minGapMinutes?: number;
  lookbackHours?: number;
}): ReappearanceEvent[] {
  const minGapMinutes = options?.minGapMinutes ?? 30;
  const lookbackHours = options?.lookbackHours ?? 24;

  const db = getDb();
  const since = Date.now() - lookbackHours * 3600_000;

  // Consecutive reports per vessel, using a window function over the archive.
  const rows = db
    .prepare(
      `SELECT mmsi, ts, lat, lon, sog,
              LAG(ts)  OVER (PARTITION BY mmsi ORDER BY ts) AS prev_ts,
              LAG(lat) OVER (PARTITION BY mmsi ORDER BY ts) AS prev_lat,
              LAG(lon) OVER (PARTITION BY mmsi ORDER BY ts) AS prev_lon,
              LAG(sog) OVER (PARTITION BY mmsi ORDER BY ts) AS prev_sog
         FROM sea_position
        WHERE ts >= ?`
    )
    .all(since) as any[];

  const names = new Map<string, string | null>();
  for (const c of db
    .prepare("SELECT id, description FROM contact WHERE kind = 'SEA'")
    .all() as any[]) {
    names.set(c.id, c.description ?? null);
  }

  const events: ReappearanceEvent[] = [];
  for (const r of rows) {
    if (r.prev_ts == null) continue;
    const gapMs = r.ts - r.prev_ts;
    const gapMinutes = Math.round(gapMs / 60_000);
    if (gapMinutes < minGapMinutes) continue;

    const jumpKm = haversineKm(r.prev_lat, r.prev_lon, r.lat, r.lon);
    const impliedKts = (jumpKm / (gapMs / 3_600_000)) / 1.852;

    events.push({
      mmsi: r.mmsi,
      name: names.get(r.mmsi) ?? null,
      gapMinutes,
      fromLat: r.prev_lat,
      fromLon: r.prev_lon,
      toLat: r.lat,
      toLon: r.lon,
      jumpKm: Number(jumpKm.toFixed(1)),
      impliedSpeedKts: Number(impliedKts.toFixed(1)),
      lastReportedSog: r.prev_sog ?? null,
      sector: describeSector(r.lat, r.lon),
      note:
        impliedKts > 40
          ? "Implied speed exceeds what a surface vessel can sustain — likely an AIS identity or position anomaly."
          : "Vessel resumed reporting after a silence.",
    });
  }

  return events.sort((a, b) => b.gapMinutes - a.gapMinutes);
}
