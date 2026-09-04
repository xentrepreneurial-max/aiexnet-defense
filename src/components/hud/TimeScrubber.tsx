"use client";

import React, { useEffect, useRef } from "react";
import { Play, Pause, Radio, History, SkipBack, SkipForward, Database } from "lucide-react";

export interface ReplayState {
  mode: "LIVE" | "REPLAY";
  atMs: number;
  playing: boolean;
  speed: number;
  bounds: { earliest: number; latest: number } | null;
  recordedCount: number;
  archiveMessage: string | null;
}

interface TimeScrubberProps {
  state: ReplayState;
  onChange: (next: Partial<ReplayState>) => void;
}

const SPEEDS = [1, 4, 16, 60];

/**
 * Replay control.
 *
 * The scrubber is bounded by what the archive actually holds, so it cannot be
 * dragged into time we never recorded. In REPLAY the map shows recorded
 * observations only — nothing is interpolated to fill a gap, so a thin period
 * looks thin.
 */
export const TimeScrubber: React.FC<TimeScrubberProps> = ({ state, onChange }) => {
  const { mode, atMs, playing, speed, bounds, recordedCount } = state;
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  // Advance replay time in real time multiplied by the chosen speed.
  useEffect(() => {
    if (mode !== "REPLAY" || !playing || !bounds) return;

    lastTickRef.current = performance.now();
    const tick = (now: number) => {
      const deltaMs = now - lastTickRef.current;
      lastTickRef.current = now;

      const next = atMsRef.current + deltaMs * speed;
      if (next >= bounds.latest) {
        onChange({ atMs: bounds.latest, playing: false });
        return;
      }
      onChange({ atMs: next });
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, playing, speed, bounds?.latest]);

  // Keep the loop reading the current instant without restarting on every tick.
  const atMsRef = useRef(atMs);
  useEffect(() => {
    atMsRef.current = atMs;
  }, [atMs]);

  const hasArchive = Boolean(bounds && bounds.latest > bounds.earliest);
  const span = hasArchive ? bounds!.latest - bounds!.earliest : 0;
  const position = hasArchive ? (atMs - bounds!.earliest) / span : 1;

  const windowLabel = hasArchive
    ? (() => {
        const mins = Math.round(span / 60000);
        if (mins < 60) return `${mins} min recorded`;
        const hrs = (mins / 60).toFixed(1);
        return `${hrs} h recorded`;
      })()
    : "no recording yet";

  return (
    <div className="tactical-glass rounded-xl border border-cyan-500/30 px-3 py-2 shadow-2xl font-mono select-none w-[640px] max-w-[92vw]">
      <div className="flex items-center gap-2.5">
        {/* LIVE / REPLAY */}
        <div className="flex items-center rounded-lg border border-slate-700 overflow-hidden flex-shrink-0">
          <button
            onClick={() => onChange({ mode: "LIVE", playing: false })}
            className={`px-2.5 py-1 text-[10px] font-bold flex items-center gap-1 transition-colors ${
              mode === "LIVE"
                ? "bg-emerald-600 text-white"
                : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            <Radio className="w-3 h-3" />
            LIVE
          </button>
          <button
            onClick={() =>
              onChange({
                mode: "REPLAY",
                atMs: bounds ? bounds.latest : Date.now(),
              })
            }
            disabled={!hasArchive}
            className={`px-2.5 py-1 text-[10px] font-bold flex items-center gap-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              mode === "REPLAY"
                ? "bg-amber-600 text-white"
                : "bg-slate-900 text-slate-400 hover:text-slate-200"
            }`}
          >
            <History className="w-3 h-3" />
            REPLAY
          </button>
        </div>

        {mode === "REPLAY" ? (
          <>
            <button
              onClick={() => onChange({ atMs: Math.max(bounds!.earliest, atMs - 60_000) })}
              className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
              title="Back one minute"
            >
              <SkipBack className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => onChange({ playing: !playing })}
              className="p-1 rounded bg-amber-950 border border-amber-500/50 text-amber-300 hover:text-amber-100"
            >
              {playing ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            </button>
            <button
              onClick={() => onChange({ atMs: Math.min(bounds!.latest, atMs + 60_000) })}
              className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-white"
              title="Forward one minute"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>

            <input
              type="range"
              min={bounds!.earliest}
              max={bounds!.latest}
              value={Math.min(bounds!.latest, Math.max(bounds!.earliest, atMs))}
              onChange={(e) => onChange({ atMs: Number(e.target.value), playing: false })}
              className="flex-1 h-1 accent-amber-400 cursor-pointer"
              style={{ minWidth: 120 }}
            />

            <div className="flex items-center rounded border border-slate-700 overflow-hidden flex-shrink-0">
              {SPEEDS.map((sp) => (
                <button
                  key={sp}
                  onClick={() => onChange({ speed: sp })}
                  className={`px-1.5 py-0.5 text-[9px] font-bold ${
                    speed === sp
                      ? "bg-amber-600 text-white"
                      : "bg-slate-900 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {sp}×
                </button>
              ))}
            </div>

            <span className="text-[10px] text-amber-300 font-bold whitespace-nowrap tabular-nums">
              {new Date(atMs).toISOString().slice(11, 19)}Z
            </span>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-between text-[10px] text-slate-400">
            <span className="flex items-center gap-1.5">
              <Database className="w-3 h-3 text-cyan-400" />
              ARCHIVE: {recordedCount.toLocaleString()} positions · {windowLabel}
            </span>
            <span className="text-slate-500">
              {hasArchive
                ? `${new Date(bounds!.earliest).toISOString().slice(11, 19)}Z → ${new Date(
                    bounds!.latest
                  )
                    .toISOString()
                    .slice(11, 19)}Z`
                : "recording starts as soon as a feed reports"}
            </span>
          </div>
        )}
      </div>

      {mode === "REPLAY" && (
        <div className="mt-1 flex items-center justify-between text-[8.5px] text-slate-500">
          <span>
            {new Date(bounds!.earliest).toISOString().slice(0, 19).replace("T", " ")}Z
          </span>
          <span className="text-amber-400/80">
            REPLAY — recorded observations only, nothing interpolated
          </span>
          <span>{new Date(bounds!.latest).toISOString().slice(0, 19).replace("T", " ")}Z</span>
        </div>
      )}

      {state.archiveMessage && (
        <p className="mt-1 text-[9px] text-amber-300/80">{state.archiveMessage}</p>
      )}

      {/* Progress track shown in both modes for orientation. */}
      {mode === "REPLAY" && (
        <div className="mt-1 h-0.5 bg-slate-800 rounded overflow-hidden">
          <div
            className="h-full bg-amber-400/70"
            style={{ width: `${Math.max(0, Math.min(1, position)) * 100}%` }}
          />
        </div>
      )}
    </div>
  );
};
