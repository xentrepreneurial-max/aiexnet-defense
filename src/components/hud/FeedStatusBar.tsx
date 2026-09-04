"use client";

import React, { useState } from "react";
import {
  Plane,
  Ship,
  Satellite,
  Flame,
  Siren,
  ChevronDown,
  ChevronUp,
  KeyRound,
} from "lucide-react";
import { FeedStatus } from "@/types/intelligence";

interface FeedStatusBarProps {
  statuses: Record<string, FeedStatus>;
}

const FEEDS: Array<{ id: string; label: string; Icon: React.ElementType }> = [
  { id: "AIR", label: "AIR / ADS-B", Icon: Plane },
  { id: "SEA", label: "SEA / AIS", Icon: Ship },
  { id: "SPACE", label: "SPACE / TLE", Icon: Satellite },
  { id: "THERMAL", label: "THERMAL / FIRMS", Icon: Flame },
  { id: "ALERTS", label: "THREAT DERIV.", Icon: Siren },
];

const STATE_STYLE: Record<
  FeedStatus["linkState"],
  { dot: string; text: string; label: string }
> = {
  LIVE: { dot: "bg-emerald-400", text: "text-emerald-300", label: "LIVE" },
  DEGRADED: { dot: "bg-amber-400", text: "text-amber-300", label: "DEGRADED" },
  OFFLINE: { dot: "bg-red-500", text: "text-red-300", label: "NO LINK" },
  NO_KEY: { dot: "bg-slate-500", text: "text-slate-400", label: "NO KEY" },
};

/**
 * Per-feed link state.
 *
 * This panel exists so an empty map is never ambiguous: the operator can
 * always tell the difference between "nothing is out there" and
 * "we are not receiving".
 */
export const FeedStatusBar: React.FC<FeedStatusBarProps> = ({ statuses }) => {
  const [expanded, setExpanded] = useState(true);

  const anyDown = FEEDS.some((f) => {
    const s = statuses[f.id];
    return s && s.linkState !== "LIVE";
  });

  return (
    <div className="tactical-glass rounded-xl border border-cyan-500/30 w-72 shadow-2xl select-none font-mono">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border-b border-slate-700/60"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold text-cyan-300">
          <span
            className={`w-2 h-2 rounded-full ${
              anyDown ? "bg-amber-400 animate-pulse" : "bg-emerald-400"
            }`}
          />
          SENSOR LINK STATUS
        </span>
        {expanded ? (
          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>

      {expanded && (
        <div className="p-2 space-y-1.5">
          {FEEDS.map(({ id, label, Icon }) => {
            const s = statuses[id];
            const style = STATE_STYLE[s?.linkState ?? "OFFLINE"];
            return (
              <div
                key={id}
                className="rounded-lg border border-slate-700/50 bg-slate-950/50 px-2 py-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-[10px] text-slate-300 font-semibold">
                    <Icon className="w-3 h-3 text-slate-400" />
                    {label}
                  </span>
                  <span className={`flex items-center gap-1 text-[9px] font-bold ${style.text}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${style.dot}`} />
                    {style.label}
                  </span>
                </div>

                <div className="mt-1 flex items-center justify-between text-[9px] text-slate-500">
                  <span className="truncate max-w-[150px]" title={s?.source}>
                    {s?.source ?? "—"}
                  </span>
                  <span className="text-slate-400">
                    {s?.count ?? 0}
                    {s?.lastUpdateAgeSec != null && (
                      <span className="text-slate-600"> · {s.lastUpdateAgeSec}s</span>
                    )}
                  </span>
                </div>

                {s?.message && (
                  <p className="mt-1 flex gap-1 text-[9px] leading-snug text-amber-300/80">
                    {s.linkState === "NO_KEY" && (
                      <KeyRound className="w-2.5 h-2.5 mt-0.5 flex-shrink-0" />
                    )}
                    <span>{s.message}</span>
                  </p>
                )}
              </div>
            );
          })}

          <p className="pt-1 text-[8.5px] leading-snug text-slate-600 border-t border-slate-800">
            Counts are live contacts actually received. An empty layer with a
            LIVE link means no contacts in coverage — not a display fault.
          </p>
        </div>
      )}
    </div>
  );
};
