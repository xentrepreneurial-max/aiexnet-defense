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

interface CoveragePoint {
  lat: number;
  lon: number;
  nm: number;
  name: string;
}

/**
 * Coverage plan.
 *
 * Each open feed caps a single query at 250 NM radius, so the region is
 * covered by a set of overlapping query points polled in rotation at roughly
 * one request per second (the rate these feeds ask for).
 *
 * CORE is queried every cycle so the national picture stays tight. EXTENDED
 * reaches across the Indian Ocean and is sampled a few points per cycle,
 * because far-field contacts matter for warning time but not for seconds of
 * latency.
 *
 * A REAL LIMIT worth stating plainly: these are terrestrial receiver networks.
 * Mid-ocean has almost no ground stations, so aircraft over open water will
 * not appear no matter how many query points are added. Closing that gap
 * needs space-based ADS-B (Aireon), which is a paid service.
 */
const CORE_POINTS: CoveragePoint[] = [
  { lat: 23.80, lon: 90.40, nm: 250, name: "DHAKA FIR CORE" },
  { lat: 21.20, lon: 91.80, nm: 250, name: "CHITTAGONG / COX'S BAZAR" },
  { lat: 25.80, lon: 92.50, nm: 250, name: "NE INDIA / ASSAM CORRIDOR" },
  { lat: 18.50, lon: 89.50, nm: 250, name: "CENTRAL BAY OF BENGAL" },
  { lat: 19.50, lon: 94.50, nm: 250, name: "MYANMAR / RAKHINE COAST" },
  { lat: 22.00, lon: 86.50, nm: 250, name: "WEST BENGAL / ODISHA" },
];

const EXTENDED_POINTS: CoveragePoint[] = [
  // Indian subcontinent
  { lat: 28.60, lon: 77.20, nm: 250, name: "DELHI / NORTH INDIA" },
  { lat: 27.70, lon: 85.30, nm: 250, name: "NEPAL / HIMALAYAN FRONT" },
  { lat: 26.90, lon: 80.90, nm: 250, name: "CENTRAL GANGETIC PLAIN" },
  { lat: 21.15, lon: 79.10, nm: 250, name: "CENTRAL INDIA" },
  { lat: 17.70, lon: 83.30, nm: 250, name: "VISAKHAPATNAM / EAST COAST" },
  { lat: 13.10, lon: 80.30, nm: 250, name: "CHENNAI / CORO. COAST" },
  { lat: 19.10, lon: 72.90, nm: 250, name: "MUMBAI / WEST COAST" },
  { lat: 10.00, lon: 76.30, nm: 250, name: "KERALA / MALABAR" },
  // Pakistan / Gulf approaches
  { lat: 24.90, lon: 67.20, nm: 250, name: "KARACHI / MAKRAN" },
  { lat: 31.50, lon: 74.40, nm: 250, name: "PUNJAB / NORTHERN FRONT" },
  { lat: 25.30, lon: 55.40, nm: 250, name: "UAE / STRAIT OF HORMUZ" },
  { lat: 21.50, lon: 59.50, nm: 250, name: "OMAN / ARABIAN SEA APPROACH" },
  // Sri Lanka and the deep Indian Ocean
  { lat: 7.20, lon: 79.90, nm: 250, name: "SRI LANKA" },
  { lat: 4.20, lon: 73.50, nm: 250, name: "MALDIVES" },
  { lat: 2.00, lon: 82.00, nm: 250, name: "EQUATORIAL INDIAN OCEAN" },
  // Andaman, Malacca and Southeast Asia
  { lat: 11.70, lon: 92.70, nm: 250, name: "ANDAMAN & NICOBAR" },
  { lat: 5.60, lon: 95.30, nm: 250, name: "NORTH SUMATRA / MALACCA N" },
  { lat: 3.10, lon: 101.70, nm: 250, name: "MALACCA STRAIT / KL" },
  { lat: 1.35, lon: 103.90, nm: 250, name: "SINGAPORE / MALACCA S" },
  { lat: 13.70, lon: 100.50, nm: 250, name: "BANGKOK / GULF OF THAILAND" },
  { lat: 16.80, lon: 96.10, nm: 250, name: "YANGON / LOWER MYANMAR" },
  { lat: 21.00, lon: 105.80, nm: 250, name: "HANOI / TONKIN" },
  // China approaches
  { lat: 25.00, lon: 102.70, nm: 250, name: "YUNNAN / SW CHINA" },
  { lat: 29.60, lon: 91.10, nm: 250, name: "TIBET PLATEAU" },
];

/** How many EXTENDED points to sample per cycle. */
const EXTENDED_PER_CYCLE = Number(process.env.ADSB_EXTENDED_PER_CYCLE || 4);

/** Cycles between global military sweeps. */
const MIL_EVERY_N_CYCLES = Number(process.env.ADSB_MIL_EVERY_N_CYCLES || 2);

/**
 * Theatre box for the global military feed. The feed is worldwide; keeping
 * every contact would fill the display with traffic on the other side of the
 * planet, so it is clipped to the strategic neighbourhood.
 */
const MIL_THEATRE = {
  minLat: Number(process.env.MIL_MIN_LAT ?? -20),
  maxLat: Number(process.env.MIL_MAX_LAT ?? 50),
  minLon: Number(process.env.MIL_MIN_LON ?? 35),
  maxLon: Number(process.env.MIL_MAX_LON ?? 130),
};

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
  taskQueue: Task[];
  cycleIndex: number;
  timer: NodeJS.Timeout | null;
  sources: Record<string, SourceHealth>;
  lastSweepComplete: number;
  sweepsCompleted: number;
  lastMilSweep: number;
  milSeenLast: number;
  startedAt: number;
}

/** Survive Next.js dev hot-reload without spawning duplicate pollers. */
const globalRef = globalThis as unknown as { __aiexnetAdsbStore?: AdsbStore };

function getStore(): AdsbStore {
  if (!globalRef.__aiexnetAdsbStore) {
    globalRef.__aiexnetAdsbStore = {
      tracks: new Map(),
      taskQueue: [],
      cycleIndex: 0,
      timer: null,
      sources: {
        "adsb.fi": { name: "adsb.fi", lastOk: 0, lastError: null, consecutiveFailures: 0 },
        "adsb.lol": { name: "adsb.lol", lastOk: 0, lastError: null, consecutiveFailures: 0 },
      },
      lastSweepComplete: 0,
      sweepsCompleted: 0,
      lastMilSweep: 0,
      milSeenLast: 0,
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

/**
 * One scheduling cycle: every CORE point, a rotating slice of EXTENDED, and
 * periodically the global military feed. Tasks are executed one per tick so
 * the request rate stays inside what the open feeds ask for.
 */
type Task =
  | { kind: "point"; point: CoveragePoint; tier: "CORE" | "EXTENDED" }
  | { kind: "mil" };

function buildCycle(cycleIndex: number): Task[] {
  const tasks: Task[] = CORE_POINTS.map((point) => ({
    kind: "point" as const,
    point,
    tier: "CORE" as const,
  }));

  const take = Math.max(0, Math.min(EXTENDED_PER_CYCLE, EXTENDED_POINTS.length));
  for (let i = 0; i < take; i++) {
    const idx = (cycleIndex * take + i) % EXTENDED_POINTS.length;
    tasks.push({ kind: "point", point: EXTENDED_POINTS[idx], tier: "EXTENDED" });
  }

  if (MIL_EVERY_N_CYCLES > 0 && cycleIndex % MIL_EVERY_N_CYCLES === 0) {
    tasks.push({ kind: "mil" });
  }

  return tasks;
}

function insideTheatre(lat: number, lon: number): boolean {
  return (
    lat >= MIL_THEATRE.minLat &&
    lat <= MIL_THEATRE.maxLat &&
    lon >= MIL_THEATRE.minLon &&
    lon <= MIL_THEATRE.maxLon
  );
}

async function runTask(task: Task) {
  const store = getStore();
  const now = Date.now();

  if (task.kind === "mil") {
    // Worldwide military feed. Every aircraft here carries the feed's own
    // military database flag, which is the strongest identification signal
    // available from open ADS-B.
    let list = await fetchPoint("https://opendata.adsb.fi/api/v2/mil", "adsb.fi");
    if (!list) list = await fetchPoint("https://api.adsb.lol/v2/mil", "adsb.lol");
    if (list) {
      const clipped = list.filter((a: any) => {
        const lat = Number(a?.lat);
        const lon = Number(a?.lon);
        return Number.isFinite(lat) && Number.isFinite(lon) && insideTheatre(lat, lon);
      });
      store.milSeenLast = clipped.length;
      store.lastMilSweep = now;
      ingest(clipped, now);
    }
    return;
  }

  const { point } = task;
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
}

async function pollOnce() {
  const store = getStore();

  if (store.taskQueue.length === 0) {
    store.taskQueue = buildCycle(store.cycleIndex);
    store.cycleIndex++;
    store.lastSweepComplete = Date.now();
    store.sweepsCompleted++;
  }

  const task = store.taskQueue.shift();
  if (task) await runTask(task);

  // Evict stale contacts so a dropped aircraft disappears instead of freezing.
  const now = Date.now();
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
    coverage: {
      corePoints: CORE_POINTS.map((p) => p.name),
      extendedPoints: EXTENDED_POINTS.length,
      extendedPerCycle: EXTENDED_PER_CYCLE,
      militarySweepEveryNCycles: MIL_EVERY_N_CYCLES,
      militaryTheatre: MIL_THEATRE,
      note:
        "Open ADS-B is a terrestrial receiver network. Mid-ocean has almost no ground stations, so open-water contacts will be sparse or absent regardless of query coverage.",
    },
    militaryTracksLastSweep: store.milSeenLast,
    lastMilSweepAgeSec:
      store.lastMilSweep > 0
        ? Number(((now - store.lastMilSweep) / 1000).toFixed(1))
        : null,
    cycleLengthSec: Number(
      (((CORE_POINTS.length + EXTENDED_PER_CYCLE + 1) * POLL_INTERVAL_MS) / 1000).toFixed(1)
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
