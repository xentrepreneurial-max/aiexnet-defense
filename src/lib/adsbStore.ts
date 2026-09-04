/**
 * Live ADS-B track store.
 *
 * A single background poller round-robins the regional coverage points at
 * roughly one request per second (the rate the open feeds ask for) and keeps
 * the merged track table in memory. API routes read the table instantly
 * instead of blocking on an upstream fetch.
 *
 * If every upstream is unreachable the store reports zero tracks and a
 * DEGRADED/OFFLINE link state. It never substitutes synthetic aircraft.
 */

import { FlightData } from "@/types/intelligence";
import { classifyTrack } from "./classify";
import { identifyIcao } from "./icao";

/** Coverage points. Each open feed caps a query at 250 NM radius. */
const COVERAGE_POINTS: Array<{ lat: number; lon: number; nm: number; name: string }> = [
  { lat: 23.80, lon: 90.40, nm: 250, name: "DHAKA FIR CORE" },
  { lat: 21.20, lon: 91.80, nm: 250, name: "CHITTAGONG / COX'S BAZAR" },
  { lat: 25.80, lon: 92.50, nm: 250, name: "NE INDIA / ASSAM CORRIDOR" },
  { lat: 18.50, lon: 89.50, nm: 250, name: "CENTRAL BAY OF BENGAL" },
  { lat: 19.50, lon: 94.50, nm: 250, name: "MYANMAR / RAKHINE COAST" },
  { lat: 22.00, lon: 86.50, nm: 250, name: "WEST BENGAL / ODISHA" },
];

const POLL_INTERVAL_MS = 1100; // one coverage point per tick, ~1 req/s
const TRACK_TTL_MS = 180_000; // drop a contact after 3 minutes of no position
const HISTORY_POINTS = 60; // trail length per track

export type LinkState = "LIVE" | "DEGRADED" | "OFFLINE";

export interface StoredTrack extends FlightData {
  /** Always set by the store — the epoch ms the position was observed. */
  positionTime: number;
  history: Array<[number, number]>;
}

interface SourceHealth {
  name: string;
  lastOk: number;
  lastError: string | null;
  consecutiveFailures: number;
}

interface AdsbStore {
  tracks: Map<string, StoredTrack>;
  pointIndex: number;
  timer: NodeJS.Timeout | null;
  sources: Record<string, SourceHealth>;
  lastSweepComplete: number;
  sweepsCompleted: number;
  startedAt: number;
}

/** Survive Next.js dev hot-reload without spawning duplicate pollers. */
const globalRef = globalThis as unknown as { __aiexnetAdsbStore?: AdsbStore };

function getStore(): AdsbStore {
  if (!globalRef.__aiexnetAdsbStore) {
    globalRef.__aiexnetAdsbStore = {
      tracks: new Map(),
      pointIndex: 0,
      timer: null,
      sources: {
        "adsb.fi": { name: "adsb.fi", lastOk: 0, lastError: null, consecutiveFailures: 0 },
        "adsb.lol": { name: "adsb.lol", lastOk: 0, lastError: null, consecutiveFailures: 0 },
      },
      lastSweepComplete: 0,
      sweepsCompleted: 0,
      startedAt: Date.now(),
    };
  }
  return globalRef.__aiexnetAdsbStore;
}

async function fetchPoint(
  url: string,
  sourceKey: string,
  timeoutMs = 6000
): Promise<any[] | null> {
  const store = getStore();
  const health = store.sources[sourceKey];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "AIEXNET-Defense/2.0 (regional air picture; contact via app operator)",
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      health.lastError = `HTTP ${res.status}`;
      health.consecutiveFailures++;
      return null;
    }
    const json = await res.json();
    const list = json.aircraft ?? json.ac ?? null;
    if (!Array.isArray(list)) {
      health.lastError = "Unexpected payload shape";
      health.consecutiveFailures++;
      return null;
    }
    health.lastOk = Date.now();
    health.lastError = null;
    health.consecutiveFailures = 0;
    return list;
  } catch (err: any) {
    health.lastError = err?.name === "AbortError" ? "Timeout" : String(err?.message || err);
    health.consecutiveFailures++;
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function toNumber(v: any): number | null {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function ingest(raw: any[], now: number) {
  const store = getStore();

  for (const a of raw) {
    const lat = toNumber(a.lat);
    const lon = toNumber(a.lon);
    const hex = String(a.hex || "").trim().toLowerCase();
    if (lat === null || lon === null || !hex) continue;

    const onGround = a.alt_baro === "ground";
    const altFt = onGround ? 0 : toNumber(a.alt_baro) ?? toNumber(a.alt_geom) ?? 0;
    const gsKts = toNumber(a.gs) ?? 0;
    const baroRateFpm = toNumber(a.baro_rate) ?? toNumber(a.geom_rate) ?? 0;
    const track = toNumber(a.track) ?? toNumber(a.true_heading) ?? toNumber(a.mag_heading) ?? 0;
    const seenPos = toNumber(a.seen_pos) ?? 0;

    const altitudeM = altFt * 0.3048;
    const velocityMs = gsKts * 0.514444;
    const verticalRateMs = baroRateFpm * 0.00508;

    const identity = identifyIcao(hex);
    const callsign = String(a.flight || "").trim();

    const cls = classifyTrack({
      hex,
      callsign,
      typeCode: a.t ?? null,
      typeDesc: a.desc ?? null,
      registration: a.r ?? null,
      dbFlags: toNumber(a.dbFlags),
      squawk: a.squawk ?? null,
      emergencyField: a.emergency ?? null,
      altitudeM,
      velocityMs,
      verticalRateMs,
      onGround,
    });

    const positionTime = now - seenPos * 1000;
    const existing = store.tracks.get(hex);

    // Ignore an older position for a track we already have fresher data on.
    if (existing && existing.positionTime > positionTime) continue;

    const history = existing ? existing.history.slice() : [];
    const last = history[history.length - 1];
    if (!last || last[0] !== lon || last[1] !== lat) {
      history.push([Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
      if (history.length > HISTORY_POINTS) history.shift();
    }

    store.tracks.set(hex, {
      icao24: hex,
      callsign: callsign || "NO CALLSIGN",
      registration: a.r ? String(a.r).trim() : null,
      aircraftType: a.t ? String(a.t).trim() : null,
      aircraftDesc: a.desc ? String(a.desc).trim() : null,
      origin_country: identity.country,
      countryIso: identity.iso,
      longitude: Number(lon.toFixed(5)),
      latitude: Number(lat.toFixed(5)),
      baro_altitude: Math.round(altitudeM),
      altitudeFt: Math.round(altFt),
      velocity: Number(velocityMs.toFixed(1)),
      groundSpeedKts: Math.round(gsKts),
      true_track: Number(track.toFixed(1)),
      vertical_rate: Number(verticalRateMs.toFixed(2)),
      verticalRateFpm: Math.round(baroRateFpm),
      squawk: a.squawk ? String(a.squawk) : null,
      on_ground: onGround,
      category: cls.category,
      threatLevel: cls.threatLevel,
      model: cls.model,
      operator: cls.operator,
      classificationBasis: cls.basis,
      emergency: cls.emergency,
      signalRssi: toNumber(a.rssi),
      messages: toNumber(a.messages),
      positionAgeSec: Number(seenPos.toFixed(1)),
      positionTime,
      lastContact: now,
      dataSource: "ADS-B",
      history,
    });
  }
}

async function pollOnce() {
  const store = getStore();
  const point = COVERAGE_POINTS[store.pointIndex % COVERAGE_POINTS.length];
  store.pointIndex++;

  const now = Date.now();

  // Primary: adsb.fi open data. Fallback: adsb.lol. Same schema family.
  let list = await fetchPoint(
    `https://opendata.adsb.fi/api/v2/lat/${point.lat}/lon/${point.lon}/dist/${point.nm}`,
    "adsb.fi"
  );
  if (!list) {
    list = await fetchPoint(
      `https://api.adsb.lol/v2/point/${point.lat}/${point.lon}/${point.nm}`,
      "adsb.lol"
    );
  }

  if (list) ingest(list, now);

  if (store.pointIndex % COVERAGE_POINTS.length === 0) {
    store.lastSweepComplete = now;
    store.sweepsCompleted++;
  }

  // Evict stale contacts so a dropped aircraft disappears instead of freezing.
  for (const [hex, t] of store.tracks) {
    if (now - t.positionTime > TRACK_TTL_MS) store.tracks.delete(hex);
  }
}

export function ensurePollerRunning() {
  const store = getStore();
  if (store.timer) return;
  // Kick one immediately so the first page load is not empty for a full tick.
  void pollOnce();
  store.timer = setInterval(() => {
    void pollOnce().catch(() => undefined);
  }, POLL_INTERVAL_MS);
  // Do not hold the process open on shutdown.
  if (typeof store.timer.unref === "function") store.timer.unref();
}

export function getLinkState(): LinkState {
  const store = getStore();
  const now = Date.now();
  const anyOk = Object.values(store.sources).some((s) => now - s.lastOk < 30_000);
  if (anyOk && store.tracks.size > 0) return "LIVE";
  if (store.tracks.size > 0) return "DEGRADED";
  return "OFFLINE";
}

export function getTracks(): StoredTrack[] {
  const store = getStore();
  return Array.from(store.tracks.values());
}

export function getFeedDiagnostics() {
  const store = getStore();
  const now = Date.now();
  return {
    linkState: getLinkState(),
    trackCount: store.tracks.size,
    coveragePoints: COVERAGE_POINTS.map((p) => p.name),
    sweepIntervalSec: Number(
      ((COVERAGE_POINTS.length * POLL_INTERVAL_MS) / 1000).toFixed(1)
    ),
    lastSweepAgeSec:
      store.lastSweepComplete > 0
        ? Number(((now - store.lastSweepComplete) / 1000).toFixed(1))
        : null,
    sweepsCompleted: store.sweepsCompleted,
    uptimeSec: Math.round((now - store.startedAt) / 1000),
    sources: Object.values(store.sources).map((s) => ({
      name: s.name,
      lastOkAgeSec: s.lastOk > 0 ? Number(((now - s.lastOk) / 1000).toFixed(1)) : null,
      lastError: s.lastError,
      consecutiveFailures: s.consecutiveFailures,
    })),
  };
}
