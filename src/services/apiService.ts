import {
  FlightData,
  SatelliteData,
  ThreatAlert,
  VesselData,
  ThermalAnomaly,
  FeedStatus,
} from "@/types/intelligence";

/**
 * Client-side feed access.
 *
 * These helpers never substitute synthetic data. If a feed is down the caller
 * receives an empty array plus a FeedStatus explaining why, and the HUD shows
 * that state instead of a comfortable-looking but false picture.
 */

export interface FeedResult<T> {
  data: T[];
  status: FeedStatus;
}

const OFFLINE_STATUS = (id: string, message: string): FeedStatus => ({
  id,
  linkState: "OFFLINE",
  source: "UNREACHABLE",
  count: 0,
  lastUpdateAgeSec: null,
  message,
});

async function getFeed<T>(path: string, id: string): Promise<FeedResult<T>> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      return { data: [], status: OFFLINE_STATUS(id, `Server returned HTTP ${res.status}`) };
    }
    const json = await res.json();
    const data: T[] = Array.isArray(json?.data) ? json.data : [];
    const status: FeedStatus = json?.status ?? OFFLINE_STATUS(id, "No status reported");
    return { data, status };
  } catch (err: any) {
    return {
      data: [],
      status: OFFLINE_STATUS(id, `Cannot reach local API: ${err?.message ?? err}`),
    };
  }
}

export const fetchLiveFlights = () => getFeed<FlightData>("/api/defense/flights", "AIR");
export const fetchLiveVessels = () => getFeed<VesselData>("/api/defense/vessels", "SEA");
export const fetchLiveSatellites = () =>
  getFeed<SatelliteData>("/api/defense/satellites", "SPACE");
export const fetchThermalAnomalies = () =>
  getFeed<ThermalAnomaly>("/api/defense/thermal", "THERMAL");
export const fetchThreatAlerts = () => getFeed<ThreatAlert>("/api/defense/alerts", "ALERTS");

// ---------------------------------------------------------------------------
// UAV telemetry
// ---------------------------------------------------------------------------

export interface DroneRecord {
  vehicleId: string;
  name: string;
  latitude: number;
  longitude: number;
  altitudeRelM: number;
  groundSpeedMs: number;
  headingDeg: number;
  batteryPercent: number | null;
  flightMode: string | null;
  armed: boolean;
  gpsFixType: number | null;
  satellitesVisible: number | null;
  linkQuality: number | null;
  linkState: "LIVE" | "STALE" | "LOST";
  linkAgeSec: number;
  history?: Array<[number, number]>;
}

export const fetchDrones = () => getFeed<DroneRecord>("/api/defense/drone", "UAV");

// ---------------------------------------------------------------------------
// Archive / replay
// ---------------------------------------------------------------------------

export interface ReplayContactRecord {
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
  offsetSec: number;
}

export async function fetchArchiveStats(): Promise<{
  bounds: { earliest: number; latest: number } | null;
  recordedCount: number;
  message: string | null;
}> {
  try {
    const res = await fetch("/api/defense/archive/stats", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const a = json.archive;
    const earliest = Math.min(
      a.air.earliest ?? Number.MAX_SAFE_INTEGER,
      a.sea.earliest ?? Number.MAX_SAFE_INTEGER
    );
    const latest = Math.max(a.air.latest ?? 0, a.sea.latest ?? 0);
    return {
      bounds: latest > 0 && earliest < Number.MAX_SAFE_INTEGER ? { earliest, latest } : null,
      recordedCount: (a.air.positions ?? 0) + (a.sea.positions ?? 0),
      message: a.lastError ?? (json.recorder?.running ? null : "Recorder is not running."),
    };
  } catch (err: any) {
    return { bounds: null, recordedCount: 0, message: `Archive unavailable: ${err?.message}` };
  }
}

export async function fetchReplayAt(
  atMs: number
): Promise<{ air: ReplayContactRecord[]; sea: ReplayContactRecord[] }> {
  try {
    const res = await fetch(`/api/defense/archive?at=${Math.round(atMs)}`, {
      cache: "no-store",
    });
    if (!res.ok) return { air: [], sea: [] };
    const json = await res.json();
    return { air: json?.data?.air ?? [], sea: json?.data?.sea ?? [] };
  } catch {
    return { air: [], sea: [] };
  }
}

/**
 * Archived rows carry only what was observed. Fields the archive does not
 * store are left null rather than guessed, and `deadReckoned` is false
 * because a replayed position is always a real report.
 */
export function replayToFlights(rows: ReplayContactRecord[]): FlightData[] {
  return rows.map((r) => ({
    icao24: r.id,
    callsign: r.callsign || "NO CALLSIGN",
    registration: r.registration,
    aircraftType: r.typeCode,
    aircraftDesc: r.description,
    origin_country: r.country ?? "Unknown",
    longitude: r.longitude,
    latitude: r.latitude,
    baro_altitude: r.altitudeFt != null ? Math.round(r.altitudeFt * 0.3048) : 0,
    altitudeFt: r.altitudeFt ?? 0,
    velocity: r.speed != null ? r.speed * 0.514444 : 0,
    groundSpeedKts: r.speed ?? 0,
    true_track: r.track ?? 0,
    on_ground: false,
    category: (r.category as FlightData["category"]) ?? "UNKNOWN",
    threatLevel: "NORMAL",
    model: r.description,
    operator: r.operator,
    classificationBasis: ["Replayed from local archive — recorded observation"],
    lastContact: r.ts,
    positionTime: r.ts,
    dataSource: "ARCHIVE",
    deadReckoned: false,
    coastAgeSec: r.offsetSec,
  }));
}

export function replayToVessels(rows: ReplayContactRecord[]): VesselData[] {
  return rows.map((r) => ({
    mmsi: r.id,
    name: r.description || `MMSI ${r.id}`,
    type: (r.category as VesselData["type"]) ?? "OTHER",
    flag: r.flag ?? "Unknown",
    latitude: r.latitude,
    longitude: r.longitude,
    speed: r.speed ?? 0,
    heading: r.track ?? 0,
    destination: "NOT RECORDED",
    status: "UNKNOWN",
    threatLevel: "NORMAL",
    imo: r.registration,
    callsign: r.callsign,
    lastReport: r.ts,
    dataSource: "ARCHIVE",
    deadReckoned: false,
    coastAgeSec: r.offsetSec,
  }));
}

// ---------------------------------------------------------------------------
// Dark vessels
// ---------------------------------------------------------------------------

export interface DarkVesselResponse {
  aisGaps: Array<{
    mmsi: string;
    name: string | null;
    flag: string | null;
    gapMinutes: number;
    severity: string;
    predictedDriftKm: number;
    sector: string;
  }>;
  reappearances: Array<{
    mmsi: string;
    name: string | null;
    gapMinutes: number;
    jumpKm: number;
    impliedSpeedKts: number;
    lastReportedSog: number | null;
  }>;
  sarLinkState: string;
  sarMessage: string | null;
  sarDetections: Array<{
    target: { latitude: number; longitude: number; approxLengthM: number; snrSigma: number };
    dark: boolean;
    matchedName: string | null;
    matchDistanceM: number | null;
  }>;
  statusMessage: string | null;
}

export async function fetchDarkVessels(
  bbox?: [number, number, number, number]
): Promise<DarkVesselResponse> {
  const query = bbox ? `?bbox=${bbox.map((n) => n.toFixed(4)).join(",")}` : "";
  try {
    const res = await fetch(`/api/defense/darkvessels${query}`, { cache: "no-store" });
    const json = await res.json();
    return {
      aisGaps: json?.aisGaps?.data ?? [],
      reappearances: json?.reappearances?.data ?? [],
      sarLinkState: json?.sar?.linkState ?? "OFFLINE",
      sarMessage: json?.sar?.message ?? null,
      sarDetections: json?.sar?.detections ?? [],
      statusMessage: json?.status?.message ?? null,
    };
  } catch (err: any) {
    return {
      aisGaps: [],
      reappearances: [],
      sarLinkState: "OFFLINE",
      sarMessage: `Analysis unavailable: ${err?.message}`,
      sarDetections: [],
      statusMessage: null,
    };
  }
}

// ---------------------------------------------------------------------------
// Mission planning
// ---------------------------------------------------------------------------

export interface PlanResult {
  analysis: any;
  qgcPlan: unknown | null;
  geofenceRing: Array<[number, number]> | null;
  conflictMarkers: Array<{
    latitude: number;
    longitude: number;
    severity: string;
    callsign: string;
  }>;
}

export async function planMission(waypoints: unknown[]): Promise<PlanResult> {
  try {
    const res = await fetch("/api/defense/mission", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ waypoints }),
    });
    const json = await res.json();
    if (!json?.analysis) {
      return {
        analysis: {
          valid: false,
          errors: [json?.error ?? "Planner returned no analysis."],
          warnings: [],
          totalDistanceKm: 0,
          maxRadiusKm: 0,
          estimatedFlightMinutes: 0,
          usableEnduranceMinutes: 0,
          enduranceMarginMinutes: 0,
          enduranceUtilisation: 0,
          conflicts: [],
          sectors: [],
        },
        qgcPlan: null,
        geofenceRing: null,
        conflictMarkers: [],
      };
    }
    return {
      analysis: json.analysis,
      qgcPlan: json.qgcPlan ?? null,
      geofenceRing: json.geofence?.ring ?? null,
      conflictMarkers: (json.analysis.conflicts ?? []).map((c: any) => ({
        latitude: c.latitude,
        longitude: c.longitude,
        severity: c.severity,
        callsign: c.callsign,
      })),
    };
  } catch (err: any) {
    return {
      analysis: {
        valid: false,
        errors: [`Planner unreachable: ${err?.message}`],
        warnings: [],
        totalDistanceKm: 0,
        maxRadiusKm: 0,
        estimatedFlightMinutes: 0,
        usableEnduranceMinutes: 0,
        enduranceMarginMinutes: 0,
        enduranceUtilisation: 0,
        conflicts: [],
        sectors: [],
      },
      qgcPlan: null,
      geofenceRing: null,
      conflictMarkers: [],
    };
  }
}
