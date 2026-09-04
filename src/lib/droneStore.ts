/**
 * Live UAV telemetry store.
 *
 * Vehicles push telemetry here from a MAVLink bridge (mavlink-router, MAVSDK,
 * or a small mavlink2rest shim). This keeps the last state per vehicle and
 * tracks link health, so an operator can see at a glance whether a vehicle is
 * still talking.
 *
 * Navigation and safety state only — position, attitude, battery, link,
 * flight mode. No stores or weapons state is modelled.
 */

export interface DroneTelemetry {
  vehicleId: string;
  name: string;
  latitude: number;
  longitude: number;
  /** Metres above the home position. */
  altitudeRelM: number;
  altitudeAmslM: number | null;
  groundSpeedMs: number;
  headingDeg: number;
  verticalSpeedMs: number | null;
  batteryPercent: number | null;
  batteryVoltage: number | null;
  /** ArduPilot / PX4 flight mode name, verbatim from the vehicle. */
  flightMode: string | null;
  armed: boolean;
  /** GPS fix type: 0 none, 2 2D, 3 3D, 4 DGPS, 5 RTK float, 6 RTK fixed. */
  gpsFixType: number | null;
  satellitesVisible: number | null;
  /** Radio link quality, 0-100. */
  linkQuality: number | null;
  homeLatitude: number | null;
  homeLongitude: number | null;
  /** Index of the mission item the vehicle is flying to. */
  currentWaypoint: number | null;
  receivedAt: number;
}

export interface StoredDrone extends DroneTelemetry {
  /** Seconds since the last telemetry packet. */
  linkAgeSec: number;
  linkState: "LIVE" | "STALE" | "LOST";
  history: Array<[number, number]>;
}

const LINK_STALE_SEC = 10;
const LINK_LOST_SEC = 60;
const DRONE_TTL_MS = 30 * 60 * 1000;
const HISTORY_POINTS = 400;

interface DroneStore {
  vehicles: Map<string, DroneTelemetry & { history: Array<[number, number]> }>;
  packetsReceived: number;
  startedAt: number;
}

const globalRef = globalThis as unknown as { __aiexnetDrones?: DroneStore };

function store(): DroneStore {
  if (!globalRef.__aiexnetDrones) {
    globalRef.__aiexnetDrones = {
      vehicles: new Map(),
      packetsReceived: 0,
      startedAt: Date.now(),
    };
  }
  return globalRef.__aiexnetDrones;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? parseFloat(v) : (v as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Accepts one telemetry packet. Returns null when the packet is unusable. */
export function ingestTelemetry(raw: Record<string, unknown>): DroneTelemetry | null {
  const s = store();

  const vehicleId = String(raw.vehicleId ?? raw.sysid ?? "").trim();
  const lat = num(raw.latitude ?? raw.lat);
  const lon = num(raw.longitude ?? raw.lon);
  if (!vehicleId || lat === null || lon === null) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

  const now = Date.now();
  const existing = s.vehicles.get(vehicleId);
  const history = existing ? existing.history.slice() : [];
  const last = history[history.length - 1];
  if (!last || last[0] !== lon || last[1] !== lat) {
    history.push([Number(lon.toFixed(6)), Number(lat.toFixed(6))]);
    if (history.length > HISTORY_POINTS) history.shift();
  }

  const telemetry: DroneTelemetry = {
    vehicleId,
    name: String(raw.name ?? `UAV ${vehicleId}`),
    latitude: Number(lat.toFixed(6)),
    longitude: Number(lon.toFixed(6)),
    altitudeRelM: num(raw.altitudeRelM ?? raw.relative_alt) ?? 0,
    altitudeAmslM: num(raw.altitudeAmslM ?? raw.alt),
    groundSpeedMs: num(raw.groundSpeedMs ?? raw.groundspeed) ?? 0,
    headingDeg: num(raw.headingDeg ?? raw.heading) ?? 0,
    verticalSpeedMs: num(raw.verticalSpeedMs ?? raw.climb),
    batteryPercent: num(raw.batteryPercent ?? raw.battery_remaining),
    batteryVoltage: num(raw.batteryVoltage ?? raw.voltage_battery),
    flightMode: raw.flightMode ? String(raw.flightMode) : null,
    armed: Boolean(raw.armed),
    gpsFixType: num(raw.gpsFixType ?? raw.fix_type),
    satellitesVisible: num(raw.satellitesVisible ?? raw.satellites_visible),
    linkQuality: num(raw.linkQuality ?? raw.remrssi),
    homeLatitude: num(raw.homeLatitude),
    homeLongitude: num(raw.homeLongitude),
    currentWaypoint: num(raw.currentWaypoint ?? raw.seq),
    receivedAt: now,
  };

  s.vehicles.set(vehicleId, { ...telemetry, history });
  s.packetsReceived++;

  // Drop vehicles that stopped talking a long time ago.
  for (const [id, v] of s.vehicles) {
    if (now - v.receivedAt > DRONE_TTL_MS) s.vehicles.delete(id);
  }

  return telemetry;
}

export function getDrones(): StoredDrone[] {
  const now = Date.now();
  return Array.from(store().vehicles.values()).map((v) => {
    const ageSec = (now - v.receivedAt) / 1000;
    return {
      ...v,
      linkAgeSec: Number(ageSec.toFixed(1)),
      linkState: ageSec > LINK_LOST_SEC ? "LOST" : ageSec > LINK_STALE_SEC ? "STALE" : "LIVE",
    };
  });
}

export function droneStatus() {
  const s = store();
  const drones = getDrones();
  const live = drones.filter((d) => d.linkState === "LIVE").length;

  return {
    id: "UAV",
    linkState: drones.length === 0 ? "OFFLINE" : live > 0 ? "LIVE" : "DEGRADED",
    source: "MAVLink telemetry bridge (POST /api/defense/drone)",
    count: drones.length,
    lastUpdateAgeSec: drones.length
      ? Math.round(Math.min(...drones.map((d) => d.linkAgeSec)))
      : null,
    message:
      drones.length === 0
        ? "No vehicle is reporting. Point a MAVLink bridge at POST /api/defense/drone to see live UAV telemetry here."
        : live === 0
        ? "All vehicles are stale — telemetry has stopped arriving."
        : null,
    packetsReceived: s.packetsReceived,
  };
}
