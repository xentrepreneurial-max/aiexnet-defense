"use client";

import React from "react";
import { AlertTriangle, Bell, Crosshair, ShieldCheck } from "lucide-react";
import { FeedStatus, ThreatAlert } from "@/types/intelligence";

interface LiveThreatFeedProps {
  alerts: ThreatAlert[];
  status?: FeedStatus;
  onSelectCoordinates?: (coords: [number, number]) => void;
}

const LINK_BADGE: Record<FeedStatus["linkState"], string> = {
  LIVE: "bg-emerald-950 text-emerald-400 border-emerald-500/40",
  DEGRADED: "bg-amber-950 text-amber-400 border-amber-500/40",
  OFFLINE: "bg-red-950 text-red-400 border-red-500/40",
  NO_KEY: "bg-slate-900 text-slate-400 border-slate-600/40",
};

const LINK_LABEL: Record<FeedStatus["linkState"], string> = {
  LIVE: "LIVE",
  DEGRADED: "DEGRADED",
  OFFLINE: "NO LINK",
  NO_KEY: "NO KEY",
};

export const LiveThreatFeed: React.FC<LiveThreatFeedProps> = ({
  alerts,
  status,
  onSelectCoordinates,
}) => {
  const linkState = status?.linkState ?? "OFFLINE";

  const getSeverityStyle = (severity: ThreatAlert["severity"]) => {
    switch (severity) {
      case "CRITICAL":
        return "border-red-500/60 bg-red-950/40 text-red-300";
      case "HIGH":
        return "border-orange-500/60 bg-orange-950/40 text-orange-300";
      case "MEDIUM":
        return "border-amber-500/60 bg-amber-950/40 text-amber-300";
      case "LOW":
      default:
        return "border-emerald-500/50 bg-emerald-950/40 text-emerald-300";
    }
  };

  return (
    <div className="tactical-glass rounded-xl border border-cyan-500/30 p-3.5 w-80 shadow-2xl select-none font-mono">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/60">
        <div className="flex items-center gap-2 text-xs font-bold text-amber-400">
          <Bell className={`w-4 h-4 ${alerts.length > 0 ? "animate-bounce" : ""}`} />
          TACTICAL THREAT STREAM
        </div>
        <span
          className={`text-[10px] px-1.5 py-0.5 rounded font-bold border ${LINK_BADGE[linkState]}`}
        >
          {LINK_LABEL[linkState]}
        </span>
      </div>

      {alerts.length === 0 ? (
        <div className="py-6 text-center">
          {linkState === "LIVE" ? (
            <>
              <ShieldCheck className="w-6 h-6 mx-auto mb-2 text-emerald-500/70" />
              <p className="text-[11px] text-emerald-300/90 font-semibold">
                NO TRIGGERING OBSERVATIONS
              </p>
              <p className="mt-1 text-[9.5px] text-slate-500 leading-snug px-2">
                Sensors are receiving. Nothing in the current picture meets an
                alert threshold.
              </p>
            </>
          ) : (
            <>
              <AlertTriangle className="w-6 h-6 mx-auto mb-2 text-red-500/70" />
              <p className="text-[11px] text-red-300 font-semibold">
                STREAM NOT RECEIVING
              </p>
              <p className="mt-1 text-[9.5px] text-slate-500 leading-snug px-2">
                {status?.message ?? "Upstream feeds unavailable."}
              </p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {alerts.map((alt) => (
            <div
              key={alt.id}
              className={`p-2.5 rounded-lg border text-xs transition-all hover:brightness-110 ${getSeverityStyle(
                alt.severity
              )}`}
            >
              <div className="flex items-start justify-between gap-2 mb-1">
                <span className="font-bold tracking-tight text-[11px] flex items-start gap-1 leading-snug">
                  <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                  {alt.title}
                </span>
                <span className="text-[9px] opacity-75 font-semibold whitespace-nowrap">
                  {alt.timestamp}
                </span>
              </div>

              <p className="text-[10px] text-slate-300 mb-2 leading-relaxed opacity-90">
                {alt.description}
              </p>

              {/* Provenance — every alert names the observation behind it. */}
              <div className="text-[8.5px] text-slate-500 mb-1.5">
                SRC: {alt.evidence.feed} · REC {alt.evidence.recordId} ·{" "}
                {new Date(alt.evidence.observedAt).toISOString().slice(11, 19)}Z
              </div>

              <div className="flex items-center justify-between text-[9px] pt-1 border-t border-slate-800/80">
                <span className="text-slate-400 truncate max-w-[180px]">
                  {alt.sector}
                </span>
                {alt.coordinates && onSelectCoordinates && (
                  <button
                    onClick={() => onSelectCoordinates(alt.coordinates!)}
                    className="flex items-center gap-1 text-cyan-300 hover:text-cyan-100 font-bold bg-slate-900/80 px-1.5 py-0.5 rounded border border-cyan-500/30"
                  >
                    <Crosshair className="w-2.5 h-2.5" />
                    LOCATE
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
