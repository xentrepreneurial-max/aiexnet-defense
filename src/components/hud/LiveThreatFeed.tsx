"use client";

import React from "react";
import { AlertTriangle, ShieldAlert, Crosshair, Bell, ArrowUpRight } from "lucide-react";
import { ThreatAlert } from "@/types/intelligence";

interface LiveThreatFeedProps {
  alerts: ThreatAlert[];
  onSelectCoordinates?: (coords: [number, number]) => void;
}

export const LiveThreatFeed: React.FC<LiveThreatFeedProps> = ({
  alerts,
  onSelectCoordinates,
}) => {
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
          <Bell className="w-4 h-4 animate-bounce" />
          TACTICAL THREAT STREAM
        </div>
        <span className="text-[10px] bg-red-950 text-red-400 border border-red-500/40 px-1.5 py-0.5 rounded font-bold">
          LIVE
        </span>
      </div>

      <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
        {alerts.map((alt) => (
          <div
            key={alt.id}
            className={`p-2.5 rounded-lg border text-xs transition-all hover:brightness-110 ${getSeverityStyle(
              alt.severity
            )}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="font-bold tracking-tight text-[11px] flex items-center gap-1">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                {alt.title}
              </span>
              <span className="text-[9px] opacity-75 font-semibold">{alt.timestamp}</span>
            </div>

            <p className="text-[10px] text-slate-300 mb-2 leading-relaxed opacity-90">
              {alt.description}
            </p>

            <div className="flex items-center justify-between text-[9px] pt-1 border-t border-slate-800/80">
              <span className="text-slate-400">SECTOR: {alt.sector}</span>
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
    </div>
  );
};
