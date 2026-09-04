"use client";

import React, { useEffect, useState } from "react";
import { 
  ShieldAlert, 
  Plane, 
  Anchor, 
  Satellite, 
  Flame, 
  Clock, 
  Crosshair, 
  LogOut, 
  Radio, 
  Eye,
  Globe2,
  MapPin
} from "lucide-react";
import { FeedStatus, UserProfile } from "@/types/intelligence";

interface TacticalHeaderProps {
  user: UserProfile;
  defconLevel: number;
  onDefconChange: (lvl: number) => void;
  airCount: number;
  seaCount: number;
  satCount: number;
  thermalCount: number;
  /** Live link state per feed — drives the header status indicator. */
  feedStatus: Record<string, FeedStatus>;
  onFlyTo: (preset: 'BD_ALL' | 'BAY_OF_BENGAL' | 'DHAKA_AIR' | 'BORDER_SECTOR' | 'GLOBAL') => void;
  onLogout: () => void;
}

export const TacticalHeader: React.FC<TacticalHeaderProps> = ({
  user,
  defconLevel,
  onDefconChange,
  airCount,
  seaCount,
  satCount,
  thermalCount,
  feedStatus,
  onFlyTo,
  onLogout,
}) => {
  const [timeUtc, setTimeUtc] = useState("");
  const [timeBst, setTimeBst] = useState("");

  useEffect(() => {
    const updateClocks = () => {
      const now = new Date();
      setTimeUtc(now.toUTCString().slice(17, 25) + " UTC");
      setTimeBst(
        now.toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour12: false }) + " BST"
      );
    };
    updateClocks();
    const timer = setInterval(updateClocks, 1000);
    return () => clearInterval(timer);
  }, []);

  /**
   * Aggregate link state. The header must never read ONLINE while feeds are
   * down — an operator glancing at it should see the true sensor state.
   */
  const linkSummary = () => {
    const tracked = ["AIR", "SEA", "SPACE", "THERMAL"];
    const present = tracked.map((id) => feedStatus[id]).filter(Boolean) as FeedStatus[];
    if (present.length === 0) {
      return { label: "INITIALISING", dot: "bg-slate-500", text: "text-slate-400", detail: "No feed has reported yet." };
    }
    const live = present.filter((s) => s.linkState === "LIVE");
    const detail = present
      .map((s) => `${s.id}: ${s.linkState}${s.count ? ` (${s.count})` : ""}`)
      .join("  |  ");

    if (live.length === present.length) {
      return { label: `ALL FEEDS LIVE`, dot: "bg-emerald-400 animate-pulse", text: "text-emerald-400", detail };
    }
    if (live.length === 0) {
      return { label: "NO SENSOR LINK", dot: "bg-red-500 animate-pulse", text: "text-red-400", detail };
    }
    return {
      label: `${live.length}/${present.length} FEEDS LIVE`,
      dot: "bg-amber-400 animate-pulse",
      text: "text-amber-400",
      detail,
    };
  };
  const link = linkSummary();

  const countTone = (id: string, live: string, dead: string) =>
    feedStatus[id]?.linkState === "LIVE" ? live : dead;

  const getDefconColor = (lvl: number) => {
    switch (lvl) {
      case 1: return "bg-red-600 text-white border-red-400 animate-pulse";
      case 2: return "bg-orange-600 text-white border-orange-400";
      case 3: return "bg-amber-600 text-white border-amber-400";
      case 4: return "bg-blue-600 text-white border-blue-400";
      case 5: default: return "bg-emerald-600 text-white border-emerald-400";
    }
  };

  return (
    <header className="h-16 w-full tactical-glass border-b border-cyan-500/30 px-4 flex items-center justify-between z-30 relative select-none">
      {/* Brand & Defcon Area */}
      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2.5">
          <div className="w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-400/50 flex items-center justify-center text-emerald-400 shadow-md shadow-emerald-950">
            <Radio className="w-5 h-5 animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold tracking-wider text-emerald-400 font-mono">
                BENGAL-EYE
              </span>
              <span className="text-[10px] bg-cyan-950 text-cyan-300 border border-cyan-500/40 px-1.5 py-0.2 rounded font-mono">
                C4ISR
              </span>
            </div>
            <div className="text-[10px] text-slate-400 font-mono tracking-tight flex items-center gap-1.5">
              <span>🇧🇩 REGIONAL AIR / SEA / SPACE PICTURE</span>
              <span className={`w-1 h-1 rounded-full ${link.dot}`} />
              <span className={link.text} title={link.detail}>
                {link.label}
              </span>
            </div>
          </div>
        </div>

        {/* DEFCON Badge */}
        <div className="flex items-center gap-1.5 pl-3 border-l border-slate-700/60 font-mono">
          <span className="text-[11px] text-slate-400 font-semibold hidden md:inline">DEFCON:</span>
          {user.role === "COMMANDER" ? (
            <select
              value={defconLevel}
              onChange={(e) => onDefconChange(Number(e.target.value))}
              className={`text-xs font-bold px-2 py-1 rounded border cursor-pointer outline-none transition-all ${getDefconColor(defconLevel)}`}
            >
              <option value={5} className="bg-slate-900 text-emerald-400">DEFCON 5 (PEACETIME)</option>
              <option value={4} className="bg-slate-900 text-blue-400">DEFCON 4 (WATCH)</option>
              <option value={3} className="bg-slate-900 text-amber-400">DEFCON 3 (ELEVATED)</option>
              <option value={2} className="bg-slate-900 text-orange-400">DEFCON 2 (HIGH READINESS)</option>
              <option value={1} className="bg-slate-900 text-red-400">DEFCON 1 (MAXIMUM ALERT)</option>
            </select>
          ) : (
            <span className={`text-xs font-bold px-2.5 py-0.5 rounded border ${getDefconColor(defconLevel)}`}>
              DEFCON {defconLevel}
            </span>
          )}
        </div>
      </div>

      {/* Center Tactical Telemetry Quick Counters & Presets */}
      <div className="hidden lg:flex items-center space-x-4 font-mono">
        {/* Quick Fly-To Sector Buttons */}
        <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-lg border border-slate-800">
          <button
            onClick={() => onFlyTo('BD_ALL')}
            className="px-2 py-1 rounded text-[11px] bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 flex items-center gap-1 transition-colors"
          >
            <MapPin className="w-3 h-3 text-emerald-400" />
            BD GRID
          </button>
          <button
            onClick={() => onFlyTo('BAY_OF_BENGAL')}
            className="px-2 py-1 rounded text-[11px] bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 flex items-center gap-1 transition-colors"
          >
            <Anchor className="w-3 h-3 text-cyan-400" />
            BAY OF BENGAL
          </button>
          <button
            onClick={() => onFlyTo('BORDER_SECTOR')}
            className="px-2 py-1 rounded text-[11px] bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 flex items-center gap-1 transition-colors"
          >
            <Crosshair className="w-3 h-3 text-amber-400" />
            SE BORDER
          </button>
          <button
            onClick={() => onFlyTo('GLOBAL')}
            className="px-2 py-1 rounded text-[11px] bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-cyan-300 flex items-center gap-1 transition-colors"
          >
            <Globe2 className="w-3 h-3 text-blue-400" />
            GLOBAL ORBIT
          </button>
        </div>

        {/* Live Counters */}
        <div className="flex items-center gap-3 text-xs bg-slate-900/60 border border-slate-700/60 px-3 py-1.5 rounded-lg">
          <div
            className={`flex items-center gap-1.5 ${countTone("AIR", "text-cyan-300", "text-slate-500 line-through decoration-red-500/60")}`}
            title={feedStatus.AIR?.message ?? "Live ADS-B contacts"}
          >
            <Plane className="w-3.5 h-3.5 text-cyan-400" />
            <span>{airCount} AIR</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div
            className={`flex items-center gap-1.5 ${countTone("SEA", "text-emerald-300", "text-slate-500 line-through decoration-red-500/60")}`}
            title={feedStatus.SEA?.message ?? "Live AIS vessel reports"}
          >
            <Anchor className="w-3.5 h-3.5 text-emerald-400" />
            <span>{seaCount} SEA</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div
            className={`flex items-center gap-1.5 ${countTone("SPACE", "text-indigo-300", "text-slate-500 line-through decoration-red-500/60")}`}
            title={feedStatus.SPACE?.message ?? "SGP4 propagated from live element sets"}
          >
            <Satellite className="w-3.5 h-3.5 text-indigo-400" />
            <span>{satCount} SAT</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div
            className={`flex items-center gap-1.5 ${countTone("THERMAL", "text-rose-300", "text-slate-500 line-through decoration-red-500/60")}`}
            title={feedStatus.THERMAL?.message ?? "NASA FIRMS active fire detections"}
          >
            <Flame className="w-3.5 h-3.5 text-rose-400" />
            <span>{thermalCount} FIRMS</span>
          </div>
        </div>
      </div>

      {/* Right User Clearance & Time */}
      <div className="flex items-center space-x-3 font-mono">
        {/* Dual Clocks */}
        <div className="text-right hidden sm:block border-r border-slate-700/60 pr-3">
          <div className="text-xs font-bold text-cyan-300 tracking-wider flex items-center gap-1 justify-end">
            <Clock className="w-3 h-3 text-cyan-400" />
            {timeBst}
          </div>
          <div className="text-[10px] text-slate-400 tracking-wide">{timeUtc}</div>
        </div>

        {/* User Card */}
        <div className="flex items-center gap-2 bg-slate-950/80 border border-slate-800 rounded-lg p-1.5 px-2.5">
          <div className="text-right">
            <div className="text-xs font-bold text-emerald-400 leading-tight">
              {user.callsign}
            </div>
            <div className="text-[9px] text-slate-400 uppercase tracking-tight">
              {user.clearance} • {user.role}
            </div>
          </div>
          <button
            onClick={onLogout}
            title="Sign Out / Change Role"
            className="p-1 rounded bg-slate-900 hover:bg-rose-950/80 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 transition-colors"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
