"use client";

import React from "react";
import { 
  X, 
  Crosshair, 
  Plane, 
  Anchor, 
  Satellite, 
  Shield, 
  Flame, 
  Compass, 
  Gauge, 
  Radio, 
  Activity, 
  AlertOctagon, 
  Layers 
} from "lucide-react";
import { DefenseBase, FlightData, SatelliteData, ThermalAnomaly, VesselData } from "@/types/intelligence";

export type SelectedTarget = 
  | { type: 'FLIGHT'; data: FlightData }
  | { type: 'VESSEL'; data: VesselData }
  | { type: 'SATELLITE'; data: SatelliteData }
  | { type: 'BASE'; data: DefenseBase }
  | { type: 'THERMAL'; data: ThermalAnomaly };

interface TargetInspectorModalProps {
  target: SelectedTarget | null;
  onClose: () => void;
}

export const TargetInspectorModal: React.FC<TargetInspectorModalProps> = ({ target, onClose }) => {
  if (!target) return null;

  return (
    <div className="w-80 tactical-glass rounded-xl border border-cyan-400/50 p-3.5 shadow-2xl shadow-cyan-950/70 font-mono select-none flex-shrink-0">
      {/* Top Banner with Type Icon and Close Button */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <div className="p-2 rounded bg-cyan-950/80 border border-cyan-500/40 text-cyan-300">
            {target.type === 'FLIGHT' && <Plane className="w-4 h-4" />}
            {target.type === 'VESSEL' && <Anchor className="w-4 h-4" />}
            {target.type === 'SATELLITE' && <Satellite className="w-4 h-4" />}
            {target.type === 'BASE' && <Shield className="w-4 h-4" />}
            {target.type === 'THERMAL' && <Flame className="w-4 h-4" />}
          </div>
          <div>
            <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider block">
              TARGET TELEMETRY INSPECTOR
            </span>
            <span className="text-xs text-slate-400">
              CLASS: {target.type}
            </span>
          </div>
        </div>

        <button
          onClick={onClose}
          className="p-1 rounded bg-slate-900/80 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/50 text-slate-400 hover:text-rose-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Target Specific Details */}
      {target.type === 'FLIGHT' && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-slate-400">CALLSIGN:</span>
            <span className="text-emerald-400 font-bold text-sm">{target.data.callsign}</span>
          </div>

          {/* Provenance banner: observed vs extrapolated. */}
          <div
            className={`flex items-center gap-1.5 p-1.5 rounded border text-[10px] ${
              target.data.deadReckoned
                ? "bg-amber-950/40 border-amber-600/40 text-amber-300"
                : "bg-emerald-950/40 border-emerald-600/40 text-emerald-300"
            }`}
          >
            <Activity className="w-3 h-3 flex-shrink-0" />
            <span>
              {target.data.deadReckoned
                ? `DEAD RECKONED · last observed ${Math.round(target.data.coastAgeSec ?? 0)}s ago`
                : "OBSERVED POSITION · direct ADS-B report"}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ICAO24:</span>
              <span className="text-cyan-300 font-bold">{target.data.icao24.toUpperCase()}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">REGISTRY:</span>
              <span className="text-slate-200">{target.data.origin_country}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TAIL NUMBER:</span>
              <span className="text-slate-200">{target.data.registration ?? "not in registry"}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TYPE:</span>
              <span className="text-slate-200">{target.data.aircraftType ?? "unknown"}</span>
            </div>
          </div>

          <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 block">AIRFRAME:</span>
            <span className="text-slate-200">
              {target.data.aircraftDesc ?? target.data.model ?? "No registry entry"}
            </span>
            {target.data.operator && (
              <span className="block mt-0.5 text-[10px] text-cyan-300">
                OPERATOR: {target.data.operator}
              </span>
            )}
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ALTITUDE:</span>
              <span className="text-slate-200">
                {(target.data.altitudeFt ?? Math.round(target.data.baro_altitude * 3.28084)).toLocaleString()} ft
              </span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">GND SPEED:</span>
              <span className="text-slate-200">
                {target.data.groundSpeedKts ?? Math.round(target.data.velocity * 1.94384)} kt
              </span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TRACK:</span>
              <span className="text-slate-200">{Math.round(target.data.true_track)}°</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">V/S:</span>
              <span className="text-slate-200">{target.data.verticalRateFpm ?? 0} fpm</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">SQUAWK:</span>
              <span className={target.data.emergency ? "text-red-400 font-bold" : "text-slate-200"}>
                {target.data.squawk ?? "----"}
              </span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">RSSI:</span>
              <span className="text-slate-200">
                {target.data.signalRssi != null ? `${target.data.signalRssi} dBFS` : "n/a"}
              </span>
            </div>
          </div>

          <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 block">POSITION:</span>
            <span className="text-slate-200">
              {target.data.latitude.toFixed(5)}°, {target.data.longitude.toFixed(5)}°
            </span>
          </div>

          {/* Why this track was classified as it was. */}
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 flex items-center gap-1 mb-1">
              <AlertOctagon className="w-3 h-3" />
              CLASSIFICATION: <span className="text-slate-300 font-bold">{target.data.category}</span>
              <span className="text-slate-600">/</span>
              <span className="text-amber-300 font-bold">{target.data.threatLevel}</span>
            </span>
            {target.data.classificationBasis && target.data.classificationBasis.length > 0 ? (
              <ul className="space-y-0.5">
                {target.data.classificationBasis.map((b, i) => (
                  <li key={i} className="text-[10px] text-slate-400 leading-snug">
                    • {b}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-[10px] text-slate-500">No classification evidence recorded.</span>
            )}
          </div>
        </div>
      )}

      {target.type === 'VESSEL' && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-slate-400">VESSEL NAME:</span>
            <span className="text-emerald-400 font-bold text-sm">{target.data.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">MMSI:</span>
              <span className="text-cyan-300 font-bold">{target.data.mmsi}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TYPE / CLASS:</span>
              <span className="text-emerald-300 font-semibold">{target.data.type}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">SPEED:</span>
              <span className="text-cyan-300 font-bold">{target.data.speed} kts</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">HEADING:</span>
              <span className="text-emerald-400 font-bold">{target.data.heading}°</span>
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 block">DESTINATION / MISSION:</span>
            <span className="text-slate-200 text-[11px]">{target.data.destination}</span>
          </div>
        </div>
      )}

      {target.type === 'SATELLITE' && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-slate-400">SATELLITE:</span>
            <span className="text-indigo-400 font-bold text-sm">{target.data.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">NORAD ID:</span>
              <span className="text-cyan-300 font-bold">#{target.data.noradId}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">MISSION TYPE:</span>
              <span className="text-indigo-300 font-semibold">{target.data.type}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ORBITAL ALTITUDE:</span>
              <span className="text-cyan-300 font-bold">{target.data.altitude.toLocaleString()} km</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">ORBITAL VELOCITY:</span>
              <span className="text-cyan-300 font-bold">{target.data.velocity} km/s</span>
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 block">OPERATING AUTHORITY:</span>
            <span className="text-slate-200 text-[11px]">{target.data.operator}</span>
          </div>
        </div>
      )}

      {target.type === 'BASE' && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-slate-400">DEFENSE BASE:</span>
            <span className="text-amber-400 font-bold text-sm">{target.data.name}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">BRANCH:</span>
              <span className="text-amber-300 font-bold">{target.data.branch}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">CODE:</span>
              <span className="text-slate-200 font-semibold">{target.data.code}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">RADAR RANGE:</span>
              <span className="text-teal-300 font-bold">{target.data.radarRangeKm} km</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">SAM DEFENSE:</span>
              <span className="text-rose-300 font-bold">{target.data.missileDefenseRangeKm || 'N/A'} km</span>
            </div>
          </div>
          <div className="bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-[10px] text-slate-500 block mb-1">STATIONED ASSETS & SENSORS:</span>
            <div className="flex flex-wrap gap-1">
              {target.data.assets.map((asset, idx) => (
                <span key={idx} className="bg-slate-900 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] text-slate-300">
                  {asset}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {target.type === 'THERMAL' && (
        <div className="space-y-2.5 text-xs">
          <div className="flex items-center justify-between bg-slate-950/60 p-2 rounded border border-slate-800">
            <span className="text-slate-400">SENSOR DETECT:</span>
            <span className="text-red-400 font-bold text-sm">{target.data.areaDescription}</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">BRIGHTNESS:</span>
              <span className="text-red-300 font-bold">{target.data.brightness} K</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">CONFIDENCE:</span>
              <span className="text-amber-300 font-bold">{target.data.confidence}%</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">SATELLITE SENSOR:</span>
              <span className="text-cyan-300">{target.data.satellite}</span>
            </div>
            <div className="bg-slate-950/40 p-2 rounded border border-slate-800">
              <span className="text-[10px] text-slate-500 block">TIME:</span>
              <span className="text-slate-300">{target.data.detectionTime}</span>
            </div>
          </div>
        </div>
      )}

      {/* Action Footer */}
      <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
        <button
          onClick={() => alert(`Target vector locked: ${JSON.stringify(target.data)}`)}
          className="flex-1 py-1.5 px-2 rounded bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-300 text-[11px] font-bold flex items-center justify-center gap-1.5 transition-colors"
        >
          <Crosshair className="w-3.5 h-3.5" />
          LOCK VECTOR
        </button>
        <button
          onClick={() => alert(`Intelligence report generated for target.`)}
          className="py-1.5 px-3 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-[11px] transition-colors"
        >
          LOG INTEL
        </button>
      </div>
    </div>
  );
};
