import { NextResponse } from "next/server";
import { getFirmsData } from "@/lib/firms";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** Thermal anomaly / active fire detections from NASA FIRMS satellites. */
export async function GET() {
  const { data, status } = await getFirmsData();

  return NextResponse.json(
    {
      success: status.linkState === "LIVE",
      status,
      timestamp: new Date().toISOString(),
      count: data.length,
      data,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
