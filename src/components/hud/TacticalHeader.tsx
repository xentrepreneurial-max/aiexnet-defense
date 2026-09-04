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
import { UserProfile } from "@/types/intelligence";

interface TacticalHeaderProps {
  user: UserProfile;
  defconLevel: number;
  onDefconChange: (lvl: number) => void;
  airCount: number;
  seaCount: number;
  satCount: number;
  thermalCount: number;
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
              <span>🇧🇩 BD MILITARY INTELLIGENCE</span>
              <span className="w-1 h-1 rounded-full bg-emerald-400" />
              <span className="text-emerald-400">ONLINE</span>
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
          <div className="flex items-center gap-1.5 text-cyan-300" title="Active Air Contacts">
            <Plane className="w-3.5 h-3.5 text-cyan-400" />
            <span>{airCount} AIR</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div className="flex items-center gap-1.5 text-emerald-300" title="Monitored Naval Vessels">
            <Anchor className="w-3.5 h-3.5 text-emerald-400" />
            <span>{seaCount} SEA</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div className="flex items-center gap-1.5 text-indigo-300" title="Active Satellites">
            <Satellite className="w-3.5 h-3.5 text-indigo-400" />
            <span>{satCount} SAT</span>
          </div>
          <div className="w-[1px] h-3 bg-slate-700" />
          <div className="flex items-center gap-1.5 text-rose-300" title="Thermal Anomalies">
            <Flame className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
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
