/**
 * Track archive — the "time machine".
 *
 * Every position the live feeds report is written to a local SQLite database
 * so the picture can be replayed at any past instant, a single contact's
 * whole history can be pulled up, and gaps in cooperative reporting (a vessel
 * that stops transmitting AIS while still in coverage) can be detected.
 *
 * Uses node:sqlite, built into Node 22+, so this adds no dependency.
 *
 * The archive stores ONLY what a feed actually reported. Dead-reckoned
 * display positions are never written — replaying an interpolation as if it
 * were an observation would make the archive lie.
 */

import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { FlightData, VesselData } from "@/types/intelligence";

const DB_DIR = process.env.ARCHIVE_DIR || path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "archive.db");

/** How long to keep position history. Contact metadata is kept indefinitely. */
const RETENTION_DAYS = Number(process.env.ARCHIVE_RETENTION_DAYS || 30);

/** Minimum movement before a new row is written, in metres. */
const MIN_MOVE_M = 25;

interface ArchiveState {
  db: DatabaseSync;
  lastAirWrite: Map<string, { lat: number; lon: number; ts: number }>;
  lastSeaWrite: Map<string, { lat: number; lon: number; ts: number }>;
  rowsWritten: number;
  lastPrune: number;
  startedAt: number;
  lastError: string | null;
}

const globalRef = globalThis as unknown as { __aiexnetArchive?: ArchiveState };

function init(): ArchiveState {
  if (globalRef.__aiexnetArchive) return globalRef.__aiexnetArchive;

  fs.mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);

  // WAL keeps reads fast while the recorder is writing.
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS air_position (
      icao24     TEXT    NOT NULL,
      ts         INTEGER NOT NULL,
      lat        REAL    NOT NULL,
      lon        REAL    NOT NULL,
      alt_ft     INTEGER,
      gs_kts     INTEGER,
      track_deg  REAL,
      vs_fpm     INTEGER,
      squawk     TEXT,
      on_ground  INTEGER,
      PRIMARY KEY (icao24, ts)
    ) WITHOUT ROWID;
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_air_ts ON air_position(ts)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sea_position (
      mmsi    TEXT    NOT NULL,
      ts      INTEGER NOT NULL,
      lat     REAL    NOT NULL,
      lon     REAL    NOT NULL,
      sog     REAL,
      cog     REAL,
      status  TEXT,
      PRIMARY KEY (mmsi, ts)
    ) WITHOUT ROWID;
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_sea_ts ON sea_position(ts)");

  // One row per contact ever seen, with the identity we resolved for it.
  db.exec(`
    CREATE TABLE IF NOT EXISTS contact (
      id           TEXT PRIMARY KEY,
      kind         TEXT NOT NULL,
      callsign     TEXT,
      registration TEXT,
      type_code    TEXT,
      description  TEXT,
      operator     TEXT,
      country      TEXT,
      category     TEXT,
      flag         TEXT,
      first_seen   INTEGER NOT NULL,
      last_seen    INTEGER NOT NULL,
      report_count INTEGER NOT NULL DEFAULT 0
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_contact_last ON contact(last_seen)");

  db.exec(`
    CREATE TABLE IF NOT EXISTS event (
      id           TEXT PRIMARY KEY,
      ts           INTEGER NOT NULL,
      kind         TEXT NOT NULL,
      severity     TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      lat          REAL,
      lon          REAL,
      feed         TEXT,
      record_id    TEXT
    );
  `);
  db.exec("CREATE INDEX IF NOT EXISTS idx_event_ts ON event(ts)");

  const state: ArchiveState = {
    db,
    lastAirWrite: new Map(),
    lastSeaWrite: new Map(),
    rowsWritten: 0,
    lastPrune: 0,
    startedAt: Date.now(),
    lastError: null,
  };
  globalRef.__aiexnetArchive = state;
  return state;
}

function metresBetween(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Record the current air picture. Only observed positions are written. */
export function recordAir(tracks: FlightData[]) {
  const st = init();
  const insertPos = st.db.prepare(
    `INSERT OR IGNORE INTO air_position
     (icao24, ts, lat, lon, alt_ft, gs_kts, track_deg, vs_fpm, squawk, on_ground)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  const upsertContact = st.db.prepare(
    `INSERT INTO contact
       (id, kind, callsign, registration, type_code, description, operator,
        country, category, flag, first_seen, last_seen, report_count)
     VALUES (?,'AIR',?,?,?,?,?,?,?,NULL,?,?,1)
     ON CONFLICT(id) DO UPDATE SET
       callsign     = COALESCE(excluded.callsign, contact.callsign),
       registration = COALESCE(excluded.registration, contact.registration),
       type_code    = COALESCE(excluded.type_code, contact.type_code),
       description  = COALESCE(excluded.description, contact.description),
       operator     = COALESCE(excluded.operator, contact.operator),
       country      = COALESCE(excluded.country, contact.country),
       category     = excluded.category,
       last_seen    = excluded.last_seen,
       report_count = contact.report_count + 1`
  );

  try {
    st.db.exec("BEGIN");
    for (const t of tracks) {
      const ts = t.positionTime ?? t.lastContact;
      if (!ts) continue;

      const prev = st.lastAirWrite.get(t.icao24);
      if (
        prev &&
        prev.ts === ts &&
        metresBetween(prev.lat, prev.lon, t.latitude, t.longitude) < MIN_MOVE_M
      ) {
        continue;
      }

      insertPos.run(
        t.icao24,
        ts,
        t.latitude,
        t.longitude,
        t.altitudeFt ?? null,
        t.groundSpeedKts ?? null,
        t.true_track ?? null,
        t.verticalRateFpm ?? null,
        t.squawk ?? null,
        t.on_ground ? 1 : 0
      );
      upsertContact.run(
        t.icao24,
        t.callsign || null,
        t.registration ?? null,
        t.aircraftType ?? null,
        t.aircraftDesc ?? null,
        t.operator ?? null,
        t.origin_country || null,
        t.category,
        ts,
        ts
      );
      st.lastAirWrite.set(t.icao24, { lat: t.latitude, lon: t.longitude, ts });
      st.rowsWritten++;
    }
    st.db.exec("COMMIT");
    st.lastError = null;
  } catch (err: any) {
    try {
      st.db.exec("ROLLBACK");
    } catch {
      /* transaction already closed */
    }
    st.lastError = String(err?.message ?? err);
  }
}

/** Record the current maritime picture. */
export function recordSea(vessels: VesselData[]) {
  const st = init();
  const insertPos = st.db.prepare(
    `INSERT OR IGNORE INTO sea_position (mmsi, ts, lat, lon, sog, cog, status)
     VALUES (?,?,?,?,?,?,?)`
  );
  const upsertContact = st.db.prepare(
    `INSERT INTO contact
       (id, kind, callsign, registration, type_code, description, operator,
        country, category, flag, first_seen, last_seen, report_count)
     VALUES (?,'SEA',?,?,?,?,NULL,NULL,?,?,?,?,1)
     ON CONFLICT(id) DO UPDATE SET
       callsign     = COALESCE(excluded.callsign, contact.callsign),
       registration = COALESCE(excluded.registration, contact.registration),
       description  = COALESCE(excluded.description, contact.description),
       category     = excluded.category,
       flag         = COALESCE(excluded.flag, contact.flag),
       last_seen    = excluded.last_seen,
       report_count = contact.report_count + 1`
  );

  try {
    st.db.exec("BEGIN");
    for (const v of vessels) {
      const ts = v.lastReport;
      if (!ts) continue;

      const prev = st.lastSeaWrite.get(v.mmsi);
      if (
        prev &&
        prev.ts === ts &&
        metresBetween(prev.lat, prev.lon, v.latitude, v.longitude) < MIN_MOVE_M
      ) {
        continue;
      }

      insertPos.run(
        v.mmsi,
        ts,
        v.latitude,
        v.longitude,
        v.speed ?? null,
        v.heading ?? null,
        v.status ?? null
      );
      upsertContact.run(
        v.mmsi, // id
        v.callsign ?? null, // callsign
        v.imo ?? null, // registration (IMO number for a ship)
        null, // type_code: AIS carries no ICAO-style designator
        v.name || null, // description: vessel name
        v.type, // category
        v.flag || null, // flag
        ts, // first_seen
        ts // last_seen
      );
      st.lastSeaWrite.set(v.mmsi, { lat: v.latitude, lon: v.longitude, ts });
      st.rowsWritten++;
    }
    st.db.exec("COMMIT");
    st.lastError = null;
  } catch (err: any) {
    try {
      st.db.exec("ROLLBACK");
    } catch {
      /* transaction already closed */
    }
    st.lastError = String(err?.message ?? err);
  }
}

/** Persist a derived alert so the event log survives a restart. */
export function recordEvents(
  events: Array<{
    id: string;
    epoch: number;
    severity: string;
    title: string;
    description: string;
    coordinates?: [number, number];
    evidence: { feed: string; recordId: string };
  }>
) {
  const st = init();
  const stmt = st.db.prepare(
    `INSERT OR IGNORE INTO event
       (id, ts, kind, severity, title, description, lat, lon, feed, record_id)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  );
  try {
    st.db.exec("BEGIN");
    for (const e of events) {
      stmt.run(
        e.id,
        e.epoch,
        e.evidence.feed,
        e.severity,
        e.title,
        e.description,
        e.coordinates?.[1] ?? null,
        e.coordinates?.[0] ?? null,
        e.evidence.feed,
        e.evidence.recordId
      );
    }
    st.db.exec("COMMIT");
  } catch {
    try {
      st.db.exec("ROLLBACK");
    } catch {
      /* already closed */
    }
  }
}

/** Drop position rows past the retention window. Runs at most hourly. */
export function pruneIfDue() {
  const st = init();
  const now = Date.now();
  if (now - st.lastPrune < 3_600_000) return;
  st.lastPrune = now;
  const cutoff = now - RETENTION_DAYS * 86_400_000;
  try {
    st.db.prepare("DELETE FROM air_position WHERE ts < ?").run(cutoff);
    st.db.prepare("DELETE FROM sea_position WHERE ts < ?").run(cutoff);
    st.db.prepare("DELETE FROM event WHERE ts < ?").run(cutoff);
  } catch (err: any) {
    st.lastError = String(err?.message ?? err);
  }
}

// ---------------------------------------------------------------------------
// Replay queries
// ---------------------------------------------------------------------------

export interface ReplayContact {
  id: string;
  kind: "AIR" | "SEA";
  callsign: string | null;
  registration: string | null;
  typeCode: string | null;
  description: string | null;
  operator: string | null;
  country: string | null;
  category: string | null;
  flag: string | null;
  latitude: number;
  longitude: number;
  altitudeFt: number | null;
  speed: number | null;
  track: number | null;
  ts: number;
  /** Seconds between the requested instant and this report. */
  offsetSec: number;
}

/**
 * The picture as it stood at a past instant.
 *
 * For each contact we take its most recent report at or before `atMs`, and
 * drop it if that report is older than `windowSec` — otherwise a contact that
 * left hours earlier would appear frozen on the replay.
 */
export function pictureAt(atMs: number, windowSec = 300): {
  air: ReplayContact[];
  sea: ReplayContact[];
} {
  const st = init();
  const floor = atMs - windowSec * 1000;

  const airRows = st.db
    .prepare(
      `SELECT p.icao24 AS id, p.ts, p.lat, p.lon, p.alt_ft, p.gs_kts, p.track_deg,
              c.callsign, c.registration, c.type_code, c.description,
              c.operator, c.country, c.category
         FROM air_position p
         JOIN (SELECT icao24, MAX(ts) AS mts
                 FROM air_position
                WHERE ts <= ? AND ts >= ?
             GROUP BY icao24) latest
           ON latest.icao24 = p.icao24 AND latest.mts = p.ts
    LEFT JOIN contact c ON c.id = p.icao24`
    )
    .all(atMs, floor) as any[];

  const seaRows = st.db
    .prepare(
      `SELECT p.mmsi AS id, p.ts, p.lat, p.lon, p.sog, p.cog, p.status,
              c.callsign, c.registration, c.description, c.category, c.flag
         FROM sea_position p
         JOIN (SELECT mmsi, MAX(ts) AS mts
                 FROM sea_position
                WHERE ts <= ? AND ts >= ?
             GROUP BY mmsi) latest
           ON latest.mmsi = p.mmsi AND latest.mts = p.ts
    LEFT JOIN contact c ON c.id = p.mmsi`
    )
    .all(atMs, floor - windowSec * 1000 * 5) as any[]; // AIS is sparser

  return {
    air: airRows.map((r) => ({
      id: r.id,
      kind: "AIR" as const,
      callsign: r.callsign ?? null,
      registration: r.registration ?? null,
      typeCode: r.type_code ?? null,
      description: r.description ?? null,
      operator: r.operator ?? null,
      country: r.country ?? null,
      category: r.category ?? null,
      flag: null,
      latitude: r.lat,
      longitude: r.lon,
      altitudeFt: r.alt_ft ?? null,
      speed: r.gs_kts ?? null,
      track: r.track_deg ?? null,
      ts: r.ts,
      offsetSec: Math.round((atMs - r.ts) / 1000),
    })),
    sea: seaRows.map((r) => ({
      id: r.id,
      kind: "SEA" as const,
      callsign: r.callsign ?? null,
      registration: r.registration ?? null,
      typeCode: null,
      description: r.description ?? null,
      operator: null,
      country: null,
      category: r.category ?? null,
      flag: r.flag ?? null,
      latitude: r.lat,
      longitude: r.lon,
      altitudeFt: null,
      speed: r.sog ?? null,
      track: r.cog ?? null,
      ts: r.ts,
      offsetSec: Math.round((atMs - r.ts) / 1000),
    })),
  };
}

/** Full observed history of one contact. */
export function contactHistory(id: string, fromMs: number, toMs: number) {
  const st = init();
  const meta = st.db.prepare("SELECT * FROM contact WHERE id = ?").get(id) as any;
  if (!meta) return null;

  const rows =
    meta.kind === "AIR"
      ? (st.db
          .prepare(
            `SELECT ts, lat, lon, alt_ft, gs_kts, track_deg, vs_fpm, squawk, on_ground
               FROM air_position WHERE icao24 = ? AND ts BETWEEN ? AND ?
           ORDER BY ts ASC`
          )
          .all(id, fromMs, toMs) as any[])
      : (st.db
          .prepare(
            `SELECT ts, lat, lon, sog, cog, status
               FROM sea_position WHERE mmsi = ? AND ts BETWEEN ? AND ?
           ORDER BY ts ASC`
          )
          .all(id, fromMs, toMs) as any[]);

  return { meta, positions: rows };
}

/** Bounds of what the archive actually holds, so the scrubber cannot
 *  be dragged into empty time. */
export function archiveStats() {
  const st = init();
  const air = st.db
    .prepare("SELECT MIN(ts) AS lo, MAX(ts) AS hi, COUNT(*) AS n FROM air_position")
    .get() as any;
  const sea = st.db
    .prepare("SELECT MIN(ts) AS lo, MAX(ts) AS hi, COUNT(*) AS n FROM sea_position")
    .get() as any;
  const contacts = st.db
    .prepare("SELECT kind, COUNT(*) AS n FROM contact GROUP BY kind")
    .all() as any[];
  const events = st.db.prepare("SELECT COUNT(*) AS n FROM event").get() as any;

  let sizeBytes: number | null = null;
  try {
    sizeBytes = fs.statSync(DB_PATH).size;
  } catch {
    sizeBytes = null;
  }

  return {
    path: DB_PATH,
    retentionDays: RETENTION_DAYS,
    sizeBytes,
    rowsWrittenThisRun: st.rowsWritten,
    uptimeSec: Math.round((Date.now() - st.startedAt) / 1000),
    lastError: st.lastError,
    air: { earliest: air?.lo ?? null, latest: air?.hi ?? null, positions: air?.n ?? 0 },
    sea: { earliest: sea?.lo ?? null, latest: sea?.hi ?? null, positions: sea?.n ?? 0 },
    contacts: Object.fromEntries(contacts.map((c) => [c.kind, c.n])),
    events: events?.n ?? 0,
  };
}

export function getDb() {
  return init().db;
}

/** Last write error, if any. Surfaced so a broken archive cannot go unnoticed. */
export function archiveLastError(): string | null {
  return init().lastError;
}
