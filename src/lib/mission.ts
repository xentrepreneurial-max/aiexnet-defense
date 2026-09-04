/**
 * UAV mission planning.
 *
 * Scope: navigation and flight safety only — route geometry, range and
 * endurance, geofencing, and deconfliction against the live air picture.
 * Plans export to the QGroundControl .plan format, so the same file loads
 * into QGroundControl or Mission Planner and flies on any ArduPilot or PX4
 * vehicle. There is no weapons or stores handling here and none is planned.
 */

import { haversineKm, bearingDeg, projectPosition, isInAdiz } from "./airspace";
import { describeSector } from "./regions";
import { FlightData } from "@/types/intelligence";

// MAVLink command identifiers used by the QGroundControl plan schema.
export const MAV_CMD = {
  NAV_WAYPOINT: 16,
  NAV_LOITER_UNLIM: 17,
  NAV_LOITER_TIME: 19,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_LAND: 21,
  NAV_TAKEOFF: 22,
  DO_CHANGE_SPEED: 178,
} as const;

/** MAV_FRAME_GLOBAL_RELATIVE_ALT — altitudes are metres above home. */
const FRAME_GLOBAL_RELATIVE_ALT = 3;

export type WaypointAction = "TAKEOFF" | "WAYPOINT" | "LOITER" | "LAND" | "RTL";

export interface Waypoint {
  latitude: number;
  longitude: number;
  /** Metres above the home position. */
  altitudeM: number;
  action: WaypointAction;
  /** Seconds to hold, for LOITER. */
  loiterSeconds?: number;
  label?: string;
}

export interface VehicleProfile {
  name: string;
  /** Cruise airspeed in metres per second. */
  cruiseSpeedMs: number;
  /** Hover / loiter speed for multirotors, metres per second. */
  hoverSpeedMs: number;
  /** Total usable endurance in minutes at cruise. */
  enduranceMinutes: number;
  /** Fraction of endurance held back as reserve, 0-1. */
  reserveFraction: number;
  /** Maximum permitted distance from home, kilometres. */
  maxRangeKm: number;
  /** Maximum permitted altitude above home, metres. */
  maxAltitudeM: number;
  /** 1 = fixed wing, 2 = multirotor, 20 = VTOL (MAV_TYPE-aligned). */
  vehicleType: number;
  /** 3 = ArduPilot, 12 = PX4 (QGroundControl firmware ids). */
  firmwareType: number;
}

export const DEFAULT_PROFILE: VehicleProfile = {
  name: "MALE FIXED-WING (generic)",
  cruiseSpeedMs: 33, // ≈ 64 kt
  hoverSpeedMs: 5,
  enduranceMinutes: 480,
  reserveFraction: 0.2,
  maxRangeKm: 500,
  maxAltitudeM: 5500,
  vehicleType: 1,
  firmwareType: 3,
};

export interface Leg {
  from: Waypoint;
  to: Waypoint;
  distanceKm: number;
  bearingDeg: number;
  climbM: number;
  estimatedSeconds: number;
}

export interface Conflict {
  /** The leg index the conflict sits on. */
  legIndex: number;
  icao24: string;
  callsign: string;
  aircraftType: string | null;
  category: string;
  /** Horizontal separation at the closest sampled point, kilometres. */
  horizontalKm: number;
  /** Vertical separation, metres. */
  verticalM: number;
  latitude: number;
  longitude: number;
  severity: "ADVISORY" | "CAUTION" | "WARNING";
}

export interface MissionAnalysis {
  valid: boolean;
  errors: string[];
  warnings: string[];
  legs: Leg[];
  totalDistanceKm: number;
  /** Straight-line distance from home to the furthest waypoint. */
  maxRadiusKm: number;
  estimatedFlightMinutes: number;
  /** Endurance actually available after the reserve is held back. */
  usableEnduranceMinutes: number;
  enduranceMarginMinutes: number;
  /** How much of usable endurance the plan consumes, 0-1. */
  enduranceUtilisation: number;
  returnLegKm: number;
  conflicts: Conflict[];
  home: Waypoint;
  sectors: string[];
}

/** Total route length including the return leg when the plan ends in RTL. */
function buildLegs(waypoints: Waypoint[], profile: VehicleProfile): Leg[] {
  const legs: Leg[] = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const from = waypoints[i];
    const to = waypoints[i + 1];
    const distanceKm = haversineKm(from.latitude, from.longitude, to.latitude, to.longitude);
    const climbM = to.altitudeM - from.altitudeM;

    // Transit is flown at cruise speed regardless of what waits at the far
    // end. A loiter adds hold time on top of the transit, it does not slow
    // the transit down.
    const travelSec = (distanceKm * 1000) / Math.max(profile.cruiseSpeedMs, 1);
    const holdSec = to.action === "LOITER" ? to.loiterSeconds ?? 0 : 0;

    legs.push({
      from,
      to,
      distanceKm: Number(distanceKm.toFixed(3)),
      bearingDeg: Number(
        bearingDeg(from.latitude, from.longitude, to.latitude, to.longitude).toFixed(1)
      ),
      climbM: Number(climbM.toFixed(1)),
      estimatedSeconds: Math.round(travelSec + holdSec),
    });
  }
  return legs;
}

/**
 * Deconfliction against the live air picture.
 *
 * Each leg is sampled at roughly 2 km intervals and every sample is compared
 * against current ADS-B contacts. This is a planning aid over a picture that
 * is seconds old and covers only aircraft that transmit ADS-B — it is not a
 * collision avoidance system, and the caller is told so.
 */
function findConflicts(
  legs: Leg[],
  traffic: FlightData[],
  horizontalKm = 9.26, // 5 NM
  verticalM = 305 // 1000 ft
): Conflict[] {
  const conflicts: Conflict[] = [];
  const seen = new Set<string>();

  legs.forEach((leg, legIndex) => {
    const steps = Math.max(2, Math.ceil(leg.distanceKm / 2));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const lat = leg.from.latitude + (leg.to.latitude - leg.from.latitude) * f;
      const lon = leg.from.longitude + (leg.to.longitude - leg.from.longitude) * f;
      const alt = leg.from.altitudeM + (leg.to.altitudeM - leg.from.altitudeM) * f;

      for (const t of traffic) {
        if (t.on_ground) continue;
        const h = haversineKm(lat, lon, t.latitude, t.longitude);
        if (h > horizontalKm) continue;
        const v = Math.abs((t.baro_altitude ?? 0) - alt);
        if (v > verticalM) continue;

        const key = `${legIndex}:${t.icao24}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const severity: Conflict["severity"] =
          h < 3.7 && v < 150 ? "WARNING" : h < 5.5 ? "CAUTION" : "ADVISORY";

        conflicts.push({
          legIndex,
          icao24: t.icao24,
          callsign: t.callsign,
          aircraftType: t.aircraftType ?? null,
          category: t.category,
          horizontalKm: Number(h.toFixed(2)),
          verticalM: Math.round(v),
          latitude: t.latitude,
          longitude: t.longitude,
          severity,
        });
      }
    }
  });

  const rank = { WARNING: 0, CAUTION: 1, ADVISORY: 2 };
  return conflicts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

export function analyseMission(
  waypoints: Waypoint[],
  profile: VehicleProfile,
  traffic: FlightData[] = []
): MissionAnalysis {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (waypoints.length < 2) {
    errors.push("A mission needs at least a launch point and one waypoint.");
  }

  const home = waypoints[0] ?? {
    latitude: 0,
    longitude: 0,
    altitudeM: 0,
    action: "TAKEOFF" as const,
  };

  const legs = buildLegs(waypoints, profile);
  const routeKm = legs.reduce((sum, l) => sum + l.distanceKm, 0);

  // A plan that ends in RTL or LAND is complete as written. One that leaves
  // the vehicle airborne somewhere else still owes a flight home, and that
  // fuel has to be counted.
  const last = waypoints[waypoints.length - 1] ?? home;
  const missionComplete = last.action === "RTL" || last.action === "LAND";
  const returnLegKm = missionComplete
    ? 0
    : haversineKm(last.latitude, last.longitude, home.latitude, home.longitude);

  const totalDistanceKm = routeKm + returnLegKm;

  let maxRadiusKm = 0;
  const sectors = new Set<string>();
  for (const w of waypoints) {
    const r = haversineKm(home.latitude, home.longitude, w.latitude, w.longitude);
    if (r > maxRadiusKm) maxRadiusKm = r;
    sectors.add(describeSector(w.latitude, w.longitude));

    if (w.altitudeM > profile.maxAltitudeM) {
      errors.push(
        `Waypoint ${w.label ?? `${w.latitude.toFixed(4)},${w.longitude.toFixed(4)}`} is at ${w.altitudeM} m, above the ${profile.maxAltitudeM} m ceiling.`
      );
    }
    if (w.altitudeM < 0) {
      errors.push("Altitudes are relative to home and cannot be negative.");
    }
    if (!isInAdiz(w.longitude, w.latitude)) {
      warnings.push(
        `Waypoint ${w.label ?? `${w.latitude.toFixed(4)},${w.longitude.toFixed(4)}`} lies outside the Bangladesh ADIZ envelope (approx.). Cross-border flight needs clearance.`
      );
    }
  }

  if (maxRadiusKm > profile.maxRangeKm) {
    errors.push(
      `Furthest waypoint is ${maxRadiusKm.toFixed(1)} km from home, beyond the ${profile.maxRangeKm} km geofence.`
    );
  }

  const usableEnduranceMinutes = profile.enduranceMinutes * (1 - profile.reserveFraction);
  const flightSeconds =
    legs.reduce((s, l) => s + l.estimatedSeconds, 0) +
    (returnLegKm * 1000) / Math.max(profile.cruiseSpeedMs, 1);
  const estimatedFlightMinutes = flightSeconds / 60;
  const enduranceMarginMinutes = usableEnduranceMinutes - estimatedFlightMinutes;

  if (enduranceMarginMinutes < 0) {
    errors.push(
      `Mission needs ${estimatedFlightMinutes.toFixed(0)} min but only ${usableEnduranceMinutes.toFixed(0)} min is usable after a ${(profile.reserveFraction * 100).toFixed(0)}% reserve.`
    );
  } else if (enduranceMarginMinutes < usableEnduranceMinutes * 0.1) {
    warnings.push(
      `Only ${enduranceMarginMinutes.toFixed(0)} min of margin remains — under 10% of usable endurance.`
    );
  }

  if (!missionComplete) {
    warnings.push(
      `Mission does not end in RTL or LAND. A ${returnLegKm.toFixed(1)} km return leg has been added to the endurance figures so the vehicle is not planned into a one-way flight.`
    );
  }
  if (waypoints[0] && waypoints[0].action !== "TAKEOFF") {
    warnings.push("First item is not TAKEOFF; the vehicle must already be airborne.");
  }

  const conflicts = findConflicts(legs, traffic);
  const warningConflicts = conflicts.filter((c) => c.severity === "WARNING");
  if (warningConflicts.length > 0) {
    warnings.push(
      `${warningConflicts.length} live ADS-B contact(s) within 2 NM and 500 ft of the route. This is a planning aid over a picture that is seconds old and only sees aircraft transmitting ADS-B — it is not collision avoidance.`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    legs,
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    maxRadiusKm: Number(maxRadiusKm.toFixed(2)),
    estimatedFlightMinutes: Number(estimatedFlightMinutes.toFixed(1)),
    usableEnduranceMinutes: Number(usableEnduranceMinutes.toFixed(1)),
    enduranceMarginMinutes: Number(enduranceMarginMinutes.toFixed(1)),
    enduranceUtilisation: Number(
      (estimatedFlightMinutes / Math.max(usableEnduranceMinutes, 1)).toFixed(3)
    ),
    returnLegKm: Number(returnLegKm.toFixed(2)),
    conflicts,
    home,
    sectors: Array.from(sectors),
  };
}

/** The maximum-radius circle for a vehicle, as a GeoJSON ring. */
export function rangeRing(
  home: { latitude: number; longitude: number },
  radiusKm: number,
  points = 128
): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= points; i++) {
    const brg = (360 * i) / points;
    const p = projectPosition(home.latitude, home.longitude, brg, radiusKm);
    ring.push([Number(p.lon.toFixed(6)), Number(p.lat.toFixed(6))]);
  }
  return ring;
}

/**
 * Export to the QGroundControl .plan schema.
 *
 * The output loads directly into QGroundControl and Mission Planner, so the
 * plan built here is the plan the vehicle flies — no retyping coordinates.
 */
export function toQgcPlan(
  waypoints: Waypoint[],
  profile: VehicleProfile,
  options?: { geofenceRadiusKm?: number }
) {
  const home = waypoints[0];
  let doJumpId = 1;

  const items = waypoints.map((w) => {
    const id = doJumpId++;
    switch (w.action) {
      case "TAKEOFF":
        return {
          AMSLAltAboveTerrain: null,
          Altitude: w.altitudeM,
          AltitudeMode: 1,
          autoContinue: true,
          command: MAV_CMD.NAV_TAKEOFF,
          doJumpId: id,
          frame: FRAME_GLOBAL_RELATIVE_ALT,
          params: [15, 0, 0, null, w.latitude, w.longitude, w.altitudeM],
          type: "SimpleItem",
        };
      case "LOITER":
        return {
          AMSLAltAboveTerrain: null,
          Altitude: w.altitudeM,
          AltitudeMode: 1,
          autoContinue: true,
          command: MAV_CMD.NAV_LOITER_TIME,
          doJumpId: id,
          frame: FRAME_GLOBAL_RELATIVE_ALT,
          params: [w.loiterSeconds ?? 60, 0, 150, 1, w.latitude, w.longitude, w.altitudeM],
          type: "SimpleItem",
        };
      case "LAND":
        return {
          AMSLAltAboveTerrain: null,
          Altitude: 0,
          AltitudeMode: 1,
          autoContinue: true,
          command: MAV_CMD.NAV_LAND,
          doJumpId: id,
          frame: FRAME_GLOBAL_RELATIVE_ALT,
          params: [0, 0, 0, null, w.latitude, w.longitude, 0],
          type: "SimpleItem",
        };
      case "RTL":
        return {
          AMSLAltAboveTerrain: null,
          Altitude: 0,
          AltitudeMode: 1,
          autoContinue: true,
          command: MAV_CMD.NAV_RETURN_TO_LAUNCH,
          doJumpId: id,
          frame: FRAME_GLOBAL_RELATIVE_ALT,
          params: [0, 0, 0, 0, 0, 0, 0],
          type: "SimpleItem",
        };
      case "WAYPOINT":
      default:
        return {
          AMSLAltAboveTerrain: null,
          Altitude: w.altitudeM,
          AltitudeMode: 1,
          autoContinue: true,
          command: MAV_CMD.NAV_WAYPOINT,
          doJumpId: id,
          frame: FRAME_GLOBAL_RELATIVE_ALT,
          params: [0, 0, 0, null, w.latitude, w.longitude, w.altitudeM],
          type: "SimpleItem",
        };
    }
  });

  const geofenceRadiusM = (options?.geofenceRadiusKm ?? profile.maxRangeKm) * 1000;

  return {
    fileType: "Plan",
    version: 1,
    groundStation: "AIEXNET Defense",
    geoFence: {
      circles: [
        {
          circle: {
            center: [home.latitude, home.longitude],
            radius: geofenceRadiusM,
          },
          inclusion: true,
          version: 1,
        },
      ],
      polygons: [],
      version: 2,
    },
    rallyPoints: { points: [], version: 2 },
    mission: {
      cruiseSpeed: profile.cruiseSpeedMs,
      hoverSpeed: profile.hoverSpeedMs,
      firmwareType: profile.firmwareType,
      vehicleType: profile.vehicleType,
      globalPlanAltitudeMode: 1,
      plannedHomePosition: [home.latitude, home.longitude, home.altitudeM],
      items,
      version: 2,
    },
  };
}
