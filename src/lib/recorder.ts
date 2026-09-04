/**
 * Archive recorder.
 *
 * Snapshots the live stores into the SQLite archive on a fixed cadence so the
 * picture can be replayed later. Runs as a single process-wide timer.
 */

import { getTracks } from "./adsbStore";
import { getVessels } from "./aisStore";
import { recordAir, recordSea, pruneIfDue } from "./archive";

const RECORD_INTERVAL_MS = Number(process.env.ARCHIVE_INTERVAL_MS || 5000);

const globalRef = globalThis as unknown as {
  __aiexnetRecorder?: { timer: NodeJS.Timeout; enabled: boolean };
};

export function ensureRecorderRunning() {
  if (process.env.ARCHIVE_ENABLED === "false") return;
  if (globalRef.__aiexnetRecorder) return;

  const timer = setInterval(() => {
    try {
      const tracks = getTracks();
      if (tracks.length > 0) recordAir(tracks);
      const vessels = getVessels();
      if (vessels.length > 0) recordSea(vessels);
      pruneIfDue();
    } catch {
      // Recording must never take the live picture down.
    }
  }, RECORD_INTERVAL_MS);

  if (typeof timer.unref === "function") timer.unref();
  globalRef.__aiexnetRecorder = { timer, enabled: true };
}

export function recorderStatus() {
  return {
    running: Boolean(globalRef.__aiexnetRecorder),
    intervalMs: RECORD_INTERVAL_MS,
    enabled: process.env.ARCHIVE_ENABLED !== "false",
  };
}
