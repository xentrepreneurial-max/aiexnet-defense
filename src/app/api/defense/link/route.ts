import { NextRequest, NextResponse } from "next/server";
import {
  connect,
  disconnect,
  linkStatus,
  uploadMission,
  setMode,
  setArmed,
  startMission,
  returnToLaunch,
  repositionTo,
  MissionWaypoint,
} from "@/lib/mavlink/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * MAVLink vehicle link.
 *
 * GET returns link and vehicle state, including the audit trail of every
 * command this session has sent.
 *
 * POST takes an `action`. Actions that move a vehicle require
 * `confirm: true` in the body — a stray request should never put an aircraft
 * in motion, and the confirmation is recorded with the command.
 *
 * Scope is navigation and flight safety, the same surface a ground control
 * station exposes. There is no payload or stores handling.
 */

const MOVING_ACTIONS = new Set([
  "arm",
  "disarm",
  "set_mode",
  "start_mission",
  "rtl",
  "reposition",
]);

export async function GET() {
  return NextResponse.json(
    { success: true, link: linkStatus(), timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON." }, { status: 400 });
  }

  const action = String(body?.action ?? "").toLowerCase();

  if (MOVING_ACTIONS.has(action) && body?.confirm !== true) {
    return NextResponse.json(
      {
        success: false,
        error: `"${action}" moves or changes the state of a real aircraft. Resend with confirm: true.`,
      },
      { status: 400 }
    );
  }

  switch (action) {
    case "connect": {
      const port = Number(body?.listenPort ?? 14550);
      if (!Number.isInteger(port) || port < 1024 || port > 65535) {
        return NextResponse.json(
          { success: false, error: "listenPort must be an integer between 1024 and 65535." },
          { status: 400 }
        );
      }
      const result = await connect({
        listenPort: port,
        vehicleHost: body?.vehicleHost,
        vehiclePort: body?.vehiclePort,
        systemId: Number(body?.systemId ?? 255),
        componentId: Number(body?.componentId ?? 190),
        vehicleName: String(body?.vehicleName ?? "UAV"),
      });
      return NextResponse.json(
        { success: result.ok, message: result.message, link: linkStatus() },
        { status: result.ok ? 200 : 500 }
      );
    }

    case "disconnect": {
      await disconnect();
      return NextResponse.json({ success: true, message: "Link closed." });
    }

    case "upload_mission": {
      const waypoints: MissionWaypoint[] = Array.isArray(body?.waypoints) ? body.waypoints : [];
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
      }
      const result = await uploadMission(waypoints);
      return NextResponse.json({
        success: result.ok,
        message: result.message,
        link: linkStatus(),
      });
    }

    case "set_mode": {
      const result = setMode(String(body?.mode ?? ""));
      return NextResponse.json({ success: result.ok, message: result.message });
    }

    case "arm":
      return NextResponse.json(withStatus(setArmed(true)));

    case "disarm":
      return NextResponse.json(withStatus(setArmed(false)));

    case "start_mission":
      return NextResponse.json(withStatus(startMission()));

    case "rtl":
      return NextResponse.json(withStatus(returnToLaunch()));

    case "reposition": {
      const lat = Number(body?.latitude);
      const lon = Number(body?.longitude);
      const alt = Number(body?.altitudeM ?? 100);
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return NextResponse.json(
          { success: false, error: "reposition needs a valid latitude and longitude." },
          { status: 400 }
        );
      }
      return NextResponse.json(withStatus(repositionTo(lat, lon, alt)));
    }

    default:
      return NextResponse.json(
        {
          success: false,
          error: `Unknown action "${action}".`,
          actions: [
            "connect",
            "disconnect",
            "upload_mission",
            "set_mode",
            "arm",
            "disarm",
            "start_mission",
            "rtl",
            "reposition",
          ],
        },
        { status: 400 }
      );
  }
}

function withStatus(result: { ok: boolean; message: string }) {
  return { success: result.ok, message: result.message, link: linkStatus() };
}
