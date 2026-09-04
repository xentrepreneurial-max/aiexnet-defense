"use client";

import React from "react";
import { 
  Layers, 
  Plane, 
  Anchor, 
  Satellite, 
  Shield, 
  Radio, 
  Flame, 
  Target, 
  Compass, 
  Eye, 
  EyeOff 
} from "lucide-react";

export interface LayerState {
  showFlights: boolean;
  showVessels: boolean;
  showSatellites: boolean;
  showDefenseBases: boolean;
  showRadarRings: boolean;
  showMissileRings: boolean;
  showADIZ: boolean;
  showEEZ: boolean;
  showThermal: boolean;
  radarSweepAnim: boolean;
}

interface LayerControlPanelProps {
  layers: LayerState;
  onToggleLayer: (layerKey: keyof LayerState) => void;
}

export const LayerControlPanel: React.FC<LayerControlPanelProps> = ({
  layers,
  onToggleLayer,
}) => {
  const layerConfigs: {
    key: keyof LayerState;
    label: string;
    icon: React.ReactNode;
    color: string;
    description: string;
  }[] = [
    {
      key: "showFlights",
      label: "Aerospace (ADS-B)",
      icon: <Plane className="w-4 h-4" />,
      color: "text-cyan-400",
      description: "Live commercial & tactical air contacts",
    },
    {
      key: "showVessels",
      label: "Maritime (AIS Naval)",
      icon: <Anchor className="w-4 h-4" />,
      color: "text-emerald-400",
      description: "Bay of Bengal naval & cargo tracks",
    },
    {
      key: "showSatellites",
      label: "Orbital Recon (TLE)",
      icon: <Satellite className="w-4 h-4" />,
      color: "text-indigo-400",
      description: "BD-1, Sentinel & Recon satellites",
    },
    {
      key: "showDefenseBases",
      label: "Military Installations",
      icon: <Shield className="w-4 h-4" />,
      color: "text-amber-400",
      description: "BAF airbases, Naval HQs, Submarine base",
    },
    {
      key: "showRadarRings",
      label: "Radar Surveillance Rings",
      icon: <Radio className="w-4 h-4" />,
      color: "text-teal-400",
      description: "Early warning 3D AESA radar envelopes",
    },
    {
      key: "showMissileRings",
      label: "SAM Air Defense Cones",
      icon: <Target className="w-4 h-4" />,
      color: "text-rose-400",
      description: "Surface-to-Air Missile protection zones",
    },
    {
      key: "showADIZ",
      label: "BD Air Defense Zone (ADIZ)",
      icon: <Compass className="w-4 h-4" />,
      color: "text-purple-400",
      description: "National airspace perimeter boundary",
    },
    {
      key: "showEEZ",
      label: "Maritime EEZ Border",
      icon: <Anchor className="w-4 h-4" />,
      color: "text-blue-400",
      description: "200 NM Exclusive Economic Zone",
    },
    {
      key: "showThermal",
      label: "Thermal Anomalies (FIRMS)",
      icon: <Flame className="w-4 h-4" />,
      color: "text-red-400",
      description: "NASA VIIRS/MODIS border hotspot sensor",
    },
  ];

  return (
    <div className="tactical-glass rounded-xl border border-cyan-500/30 p-3.5 w-72 shadow-2xl select-none font-mono">
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-700/60">
        <div className="flex items-center gap-2 text-xs font-bold text-cyan-300">
          <Layers className="w-4 h-4 text-cyan-400" />
          INTELLIGENCE LAYERS
        </div>
        <span className="text-[10px] text-slate-400 uppercase">9 FEEDS</span>
      </div>

      <div className="space-y-1.5 max-h-[calc(100vh-280px)] overflow-y-auto pr-1">
        {layerConfigs.map(({ key, label, icon, color, description }) => {
          const isActive = layers[key];
          return (
            <button
              key={key}
              onClick={() => onToggleLayer(key)}
              className={`w-full text-left p-2 rounded-lg border transition-all flex items-center justify-between group ${
                isActive
                  ? "bg-slate-900/90 border-cyan-500/40 shadow-sm shadow-cyan-950"
                  : "bg-slate-950/40 border-slate-800 text-slate-500 opacity-60 hover:opacity-100"
              }`}
            >
              <div className="flex items-center gap-2.5">
                <div className={`p-1 rounded ${isActive ? "bg-slate-800/80 " + color : "text-slate-500"}`}>
                  {icon}
                </div>
                <div>
                  <div className={`text-xs font-semibold ${isActive ? "text-slate-200" : "text-slate-400"}`}>
                    {label}
                  </div>
                  <div className="text-[9px] text-slate-400 tracking-tight leading-none mt-0.5">
                    {description}
                  </div>
                </div>
              </div>
              <div className="pl-2">
                {isActive ? (
                  <Eye className="w-3.5 h-3.5 text-cyan-400" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5 text-slate-600" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Radar Animation Toggle */}
      <div className="mt-3 pt-2 border-t border-slate-800 flex items-center justify-between text-xs">
        <span className="text-slate-400 text-[11px] flex items-center gap-1.5">
          <Radio className="w-3 h-3 text-emerald-400" />
          Radar Sweep Shader
        </span>
        <button
          onClick={() => onToggleLayer("radarSweepAnim")}
          className={`px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
            layers.radarSweepAnim
              ? "bg-emerald-950 text-emerald-300 border-emerald-500/50"
              : "bg-slate-900 text-slate-500 border-slate-700"
          }`}
        >
          {layers.radarSweepAnim ? "ACTIVE" : "OFF"}
        </button>
      </div>
    </div>
  );
};
