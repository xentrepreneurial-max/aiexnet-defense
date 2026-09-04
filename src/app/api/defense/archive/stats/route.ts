import { NextResponse } from "next/server";
import { archiveStats } from "@/lib/archive";
import { ensureRecorderRunning, recorderStatus } from "@/lib/recorder";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/** What the archive holds and whether recording is actually running. */
export async function GET() {
  ensureRecorderRunning();
  return NextResponse.json(
    {
      success: true,
      recorder: recorderStatus(),
      archive: archiveStats(),
      timestamp: new Date().toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
