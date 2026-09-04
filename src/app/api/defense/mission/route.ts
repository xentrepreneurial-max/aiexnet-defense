import { NextRequest, NextResponse } from "next/server";
import {
  analyseMission,
  toQgcPlan,
  rangeRing,
  DEFAULT_PROFILE,
  VehicleProfile,
  Waypoint,
} from "@/lib/mission";
import { ensurePollerRunning, getTracks } from "@/lib/adsbStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Mission planning.
 *
 * POST a waypoint list and a vehicle profile; returns route geometry, range
 * and endurance figures, geofence and airspace validation, deconfliction
 * against the live ADS-B picture, and a QGroundControl .plan ready to load
 * into QGroundControl or Mission Planner.
 *
 * Navigation and flight safety only. No weapons or stores handling.
 */
export async function POST(req: NextRequest) {
  ensurePollerRunning();

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON." }, { status: 400 });
  }

  const waypoints: Waypoint[] = Array.isArray(body?.waypoints) ? body.waypoints : [];
  if (waypoints.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "`waypoints` is required.",
        example: {
          waypoints: [
            { latitude: 21.452, longitude: 91.9639, altitudeM: 0, action: "TAKEOFF", label: "BAF Cox's Bazar" },
            { latitude: 20.5, longitude: 91.2, altitudeM: 3000, action: "WAYPOINT" },
            { latitude: 20.0, longitude: 90.5, altitudeM: 3000, action: "LOITER", loiterSeconds: 900 },
            { latitude: 21.452, longitude: 91.9639, altitudeM: 0, action: "RTL" },
          ],
        },
      },
      { status: 400 }
    );
  }

  for (const [i, w] of waypoints.entries()) {
    if (
      typeof w?.latitude !== "number" ||
      typeof w?.longitude !== "number" ||
      Math.abs(w.latitude) > 90 ||
      Math.abs(w.longitude) > 180
    ) {
      return NextResponse.json(
        { success: false, error: `Waypoint ${i} has an invalid position.` },
        { status: 400 }
      );
    }
    if (typeof w.altitudeM !== "number") w.altitudeM = 0;
    if (!w.action) w.action = i === 0 ? "TAKEOFF" : "WAYPOINT";
  }

  const profile: VehicleProfile = { ...DEFAULT_PROFILE, ...(body?.profile ?? {}) };
  const analysis = analyseMission(waypoints, profile, getTracks());
  const plan = toQgcPlan(waypoints, profile, {
    geofenceRadiusKm: body?.geofenceRadiusKm,
  });

  return NextResponse.json(
    {
      success: analysis.valid,
      profile,
      analysis,
      geofence: {
        radiusKm: body?.geofenceRadiusKm ?? profile.maxRangeKm,
        ring: rangeRing(analysis.home, body?.geofenceRadiusKm ?? profile.maxRangeKm),
      },
      qgcPlan: plan,
      scope:
        "Navigation and flight safety planning only. Deconfliction is advisory: it sees a picture seconds old and only aircraft transmitting ADS-B, and is not a collision avoidance system.",
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
