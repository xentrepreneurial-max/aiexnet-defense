import { NextRequest, NextResponse } from "next/server";
import { getDrones, droneStatus, ingestTelemetry } from "@/lib/droneStore";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Live UAV telemetry. */
export async function GET() {
  const drones = getDrones();
  return NextResponse.json(
    {
      success: true,
      status: droneStatus(),
      timestamp: new Date().toISOString(),
      count: drones.length,
      data: drones,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}

/**
 * Telemetry ingest.
 *
 * Accepts one packet or an array of packets from a MAVLink bridge. Minimum
 * required fields are vehicleId, latitude and longitude; everything else is
 * optional and reported as null when the vehicle does not send it.
 */
export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON." }, { status: 400 });
  }

  const packets = Array.isArray(body) ? body : [body];
  if (packets.length > 100) {
    return NextResponse.json(
      { success: false, error: "At most 100 packets per request." },
      { status: 400 }
    );
  }

  const accepted: string[] = [];
  const rejected: number[] = [];
  packets.forEach((p, i) => {
    const result =
      p && typeof p === "object" ? ingestTelemetry(p as Record<string, unknown>) : null;
    if (result) accepted.push(result.vehicleId);
    else rejected.push(i);
  });

  return NextResponse.json(
    {
      success: rejected.length === 0,
      accepted: accepted.length,
      vehicles: Array.from(new Set(accepted)),
      rejectedIndices: rejected,
      note: rejected.length
        ? "Rejected packets were missing vehicleId, latitude or longitude, or carried an out-of-range position."
        : null,
    },
    { status: rejected.length && !accepted.length ? 400 : 200 }
  );
}
