"use client";

import React, { useState } from "react";
import {
  Route,
  Plane,
  Ship,
  Trash2,
  Download,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Radar,
  ChevronDown,
  ChevronUp,
  Battery,
  Signal,
} from "lucide-react";

export interface PlannerWaypoint {
  latitude: number;
  longitude: number;
  altitudeM: number;
  action: "TAKEOFF" | "WAYPOINT" | "LOITER" | "LAND" | "RTL";
  loiterSeconds?: number;
  label?: string;
}

export interface MissionAnalysisView {
  valid: boolean;
  errors: string[];
  warnings: string[];
  totalDistanceKm: number;
  maxRadiusKm: number;
  estimatedFlightMinutes: number;
  usableEnduranceMinutes: number;
  enduranceMarginMinutes: number;
  enduranceUtilisation: number;
  conflicts: Array<{
    severity: string;
    callsign: string;
    aircraftType: string | null;
    horizontalKm: number;
    verticalM: number;
  }>;
  sectors: string[];
}

export interface DroneView {
  vehicleId: string;
  name: string;
  latitude: number;
  longitude: number;
  headingDeg: number;
  altitudeRelM: number;
  groundSpeedMs: number;
  batteryPercent: number | null;
  flightMode: string | null;
  armed: boolean;
  gpsFixType: number | null;
  satellitesVisible: number | null;
  linkQuality: number | null;
  linkState: "LIVE" | "STALE" | "LOST";
  linkAgeSec: number;
  history?: Array<[number, number]>;
}

export interface DarkVesselView {
  aisGaps: Array<{
    mmsi: string;
    name: string | null;
    flag: string | null;
    gapMinutes: number;
    severity: string;
    predictedDriftKm: number;
    sector: string;
  }>;
  reappearances: Array<{
    mmsi: string;
    name: string | null;
    gapMinutes: number;
    jumpKm: number;
    impliedSpeedKts: number;
    lastReportedSog: number | null;
  }>;
  sarLinkState: string;
  sarMessage: string | null;
  sarDetections: Array<{
    target: { latitude: number; longitude: number; approxLengthM: number; snrSigma: number };
    dark: boolean;
    matchedName: string | null;
    matchDistanceM: number | null;
  }>;
  statusMessage: string | null;
}

interface OperationsDockProps {
  planningMode: boolean;
  onTogglePlanning: () => void;
  waypoints: PlannerWaypoint[];
  onUpdateWaypoint: (index: number, patch: Partial<PlannerWaypoint>) => void;
  onRemoveWaypoint: (index: number) => void;
  onClearMission: () => void;
  onAppendReturn: () => void;
  analysis: MissionAnalysisView | null;
  analysing: boolean;
  planJson: unknown | null;
  drones: DroneView[];
  droneMessage: string | null;
  dark: DarkVesselView | null;
  darkLoading: boolean;
  onRunSarSweep: () => void;
}

type Tab = "MISSION" | "UAV" | "MARITIME";

/**
 * Operations dock.
 *
 * Mission planning, live UAV telemetry, and maritime dark-vessel analysis.
 * Planning covers navigation and flight safety only — route, range, endurance,
 * geofence and airspace deconfliction. There is no stores or weapons handling.
 */
export const OperationsDock: React.FC<OperationsDockProps> = ({
  planningMode,
  onTogglePlanning,
  waypoints,
  onUpdateWaypoint,
  onRemoveWaypoint,
  onClearMission,
  onAppendReturn,
  analysis,
  analysing,
  planJson,
  drones,
  droneMessage,
  dark,
  darkLoading,
  onRunSarSweep,
}) => {
  const [tab, setTab] = useState<Tab>("MISSION");
  const [open, setOpen] = useState(true);

  const downloadPlan = () => {
    if (!planJson) return;
    const blob = new Blob([JSON.stringify(planJson, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `aiexnet-mission-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "")}.plan`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const tabs: Array<{ id: Tab; label: string; Icon: React.ElementType; badge?: number }> = [
    { id: "MISSION", label: "MISSION", Icon: Route, badge: waypoints.length || undefined },
    { id: "UAV", label: "UAV", Icon: Plane, badge: drones.length || undefined },
    {
      id: "MARITIME",
      label: "MARITIME",
      Icon: Ship,
      badge: dark ? dark.aisGaps.length || undefined : undefined,
    },
  ];

  return (
    <div className="tactical-glass rounded-xl border border-cyan-500/30 w-80 shadow-2xl font-mono select-none">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border-b border-slate-700/60"
      >
        <span className="flex items-center gap-2 text-[11px] font-bold text-cyan-300">
          <Radar className="w-4 h-4 text-cyan-400" />
          OPERATIONS
        </span>
        {open ? (
          <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
        ) : (
          <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
        )}
      </button>

      {open && (
        <>
          <div className="flex border-b border-slate-800">
            {tabs.map(({ id, label, Icon, badge }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex-1 px-2 py-1.5 text-[9.5px] font-bold flex items-center justify-center gap-1 transition-colors ${
                  tab === id
                    ? "bg-slate-900 text-cyan-300 border-b-2 border-cyan-400"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                <Icon className="w-3 h-3" />
                {label}
                {badge != null && (
                  <span className="ml-0.5 px-1 rounded bg-slate-800 text-[8px] text-slate-300">
                    {badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-2.5 max-h-[46vh] overflow-y-auto scrollbar-thin">
            {tab === "MISSION" && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={onTogglePlanning}
                    className={`flex-1 px-2 py-1.5 rounded text-[10px] font-bold border transition-colors ${
                      planningMode
                        ? "bg-cyan-600 text-white border-cyan-400"
                        : "bg-slate-900 text-cyan-300 border-slate-700 hover:border-cyan-500/60"
                    }`}
                  >
                    {planningMode ? "PLACING WAYPOINTS — CLICK MAP" : "START PLANNING"}
                  </button>
                  <button
                    onClick={onClearMission}
                    disabled={waypoints.length === 0}
                    className="p-1.5 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-rose-300 disabled:opacity-40"
                    title="Clear mission"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                {waypoints.length === 0 ? (
                  <p className="text-[10px] text-slate-500 leading-relaxed py-2">
                    No waypoints. Start planning, then click the map to place a launch
                    point and a route. Range, endurance and airspace conflicts are
                    computed against the live picture as you go.
                  </p>
                ) : (
                  <div className="space-y-1">
                    {waypoints.map((w, i) => (
                      <div
                        key={i}
                        className="rounded border border-slate-800 bg-slate-950/60 p-1.5"
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-[9px] text-slate-500 w-4">{i}</span>
                          <select
                            value={w.action}
                            onChange={(e) =>
                              onUpdateWaypoint(i, {
                                action: e.target.value as PlannerWaypoint["action"],
                              })
                            }
                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[9px] text-slate-200 outline-none"
                          >
                            <option>TAKEOFF</option>
                            <option>WAYPOINT</option>
                            <option>LOITER</option>
                            <option>LAND</option>
                            <option>RTL</option>
                          </select>
                          <input
                            type="number"
                            value={w.altitudeM}
                            onChange={(e) =>
                              onUpdateWaypoint(i, { altitudeM: Number(e.target.value) })
                            }
                            className="w-14 bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[9px] text-slate-200 outline-none"
                            title="Altitude above home, metres"
                          />
                          <span className="text-[8px] text-slate-500">m</span>
                          <button
                            onClick={() => onRemoveWaypoint(i)}
                            className="text-slate-500 hover:text-rose-400"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                        <div className="mt-0.5 text-[8.5px] text-slate-500">
                          {w.latitude.toFixed(4)}, {w.longitude.toFixed(4)}
                          {w.action === "LOITER" && (
                            <>
                              {" · hold "}
                              <input
                                type="number"
                                value={w.loiterSeconds ?? 600}
                                onChange={(e) =>
                                  onUpdateWaypoint(i, { loiterSeconds: Number(e.target.value) })
                                }
                                className="w-12 bg-slate-900 border border-slate-700 rounded px-1 text-[8.5px] text-slate-200 outline-none"
                              />
                              {" s"}
                            </>
                          )}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={onAppendReturn}
                      className="w-full px-2 py-1 rounded bg-slate-900 border border-slate-700 text-[9.5px] text-emerald-300 hover:border-emerald-500/50"
                    >
                      + APPEND RETURN TO LAUNCH
                    </button>
                  </div>
                )}

                {analysing && (
                  <p className="flex items-center gap-1.5 text-[10px] text-slate-400">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Computing route and deconfliction…
                  </p>
                )}

                {analysis && (
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5 text-[10px] font-bold">
                      {analysis.valid ? (
                        <>
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span className="text-emerald-300">MISSION FLYABLE</span>
                        </>
                      ) : (
                        <>
                          <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                          <span className="text-rose-300">MISSION NOT FLYABLE</span>
                        </>
                      )}
                    </div>

                    <div className="grid grid-cols-2 gap-1 text-[9px]">
                      <Stat label="ROUTE" value={`${analysis.totalDistanceKm} km`} />
                      <Stat label="MAX RADIUS" value={`${analysis.maxRadiusKm} km`} />
                      <Stat
                        label="FLIGHT TIME"
                        value={`${analysis.estimatedFlightMinutes.toFixed(0)} min`}
                      />
                      <Stat
                        label="MARGIN"
                        value={`${analysis.enduranceMarginMinutes.toFixed(0)} min`}
                        tone={analysis.enduranceMarginMinutes < 0 ? "bad" : "good"}
                      />
                    </div>

                    <div>
                      <div className="flex justify-between text-[8.5px] text-slate-500 mb-0.5">
                        <span>ENDURANCE USED</span>
                        <span>{(analysis.enduranceUtilisation * 100).toFixed(0)}%</span>
                      </div>
                      <div className="h-1 rounded bg-slate-800 overflow-hidden">
                        <div
                          className={`h-full ${
                            analysis.enduranceUtilisation > 1
                              ? "bg-rose-500"
                              : analysis.enduranceUtilisation > 0.9
                              ? "bg-amber-400"
                              : "bg-emerald-400"
                          }`}
                          style={{
                            width: `${Math.min(100, analysis.enduranceUtilisation * 100)}%`,
                          }}
                        />
                      </div>
                    </div>

                    {analysis.errors.map((e, i) => (
                      <p key={i} className="text-[9px] text-rose-300 leading-snug">
                        ✕ {e}
                      </p>
                    ))}
                    {analysis.warnings.map((w, i) => (
                      <p key={i} className="text-[9px] text-amber-300/90 leading-snug">
                        ⚠ {w}
                      </p>
                    ))}

                    {analysis.conflicts.length > 0 && (
                      <div className="pt-1 border-t border-slate-800">
                        <p className="text-[9px] text-slate-400 mb-0.5">
                          AIRSPACE CONFLICTS ({analysis.conflicts.length})
                        </p>
                        {analysis.conflicts.slice(0, 5).map((c, i) => (
                          <p
                            key={i}
                            className={`text-[8.5px] ${
                              c.severity === "WARNING" ? "text-rose-300" : "text-amber-300/80"
                            }`}
                          >
                            {c.severity} · {c.callsign} ({c.aircraftType ?? "?"}) ·{" "}
                            {c.horizontalKm} km / {c.verticalM} m
                          </p>
                        ))}
                      </div>
                    )}

                    <button
                      onClick={downloadPlan}
                      disabled={!planJson}
                      className="w-full mt-1 px-2 py-1.5 rounded bg-cyan-950 border border-cyan-500/50 text-[10px] font-bold text-cyan-200 hover:bg-cyan-900 disabled:opacity-40 flex items-center justify-center gap-1.5"
                    >
                      <Download className="w-3 h-3" />
                      EXPORT .plan (QGroundControl)
                    </button>

                    <p className="text-[8px] text-slate-600 leading-snug">
                      Navigation and flight safety planning only. Deconfliction is
                      advisory: it sees a picture seconds old and only aircraft
                      transmitting ADS-B. It is not collision avoidance.
                    </p>
                  </div>
                )}
              </div>
            )}

            {tab === "UAV" && (
              <div className="space-y-1.5">
                {drones.length === 0 ? (
                  <p className="text-[10px] text-slate-500 leading-relaxed">
                    {droneMessage ??
                      "No vehicle is reporting telemetry."}
                  </p>
                ) : (
                  drones.map((d) => (
                    <div
                      key={d.vehicleId}
                      className="rounded-lg border border-slate-800 bg-slate-950/70 p-2"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold text-violet-200">{d.name}</span>
                        <span
                          className={`text-[8.5px] font-bold px-1 rounded border ${
                            d.linkState === "LIVE"
                              ? "text-emerald-300 border-emerald-500/40 bg-emerald-950/50"
                              : d.linkState === "STALE"
                              ? "text-amber-300 border-amber-500/40 bg-amber-950/50"
                              : "text-rose-300 border-rose-500/40 bg-rose-950/50"
                          }`}
                        >
                          {d.linkState} {d.linkAgeSec}s
                        </span>
                      </div>
                      <div className="mt-1 grid grid-cols-3 gap-1 text-[8.5px]">
                        <Stat label="ALT" value={`${Math.round(d.altitudeRelM)} m`} />
                        <Stat label="SPD" value={`${Math.round(d.groundSpeedMs)} m/s`} />
                        <Stat label="MODE" value={d.flightMode ?? "--"} />
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[8.5px] text-slate-400">
                        <span className="flex items-center gap-0.5">
                          <Battery
                            className={`w-3 h-3 ${
                              (d.batteryPercent ?? 100) < 25 ? "text-rose-400" : "text-slate-500"
                            }`}
                          />
                          {d.batteryPercent != null ? `${Math.round(d.batteryPercent)}%` : "--"}
                        </span>
                        <span className="flex items-center gap-0.5">
                          <Signal className="w-3 h-3 text-slate-500" />
                          {d.linkQuality != null ? `${d.linkQuality}%` : "--"}
                        </span>
                        <span>
                          GPS {d.gpsFixType ?? "-"}/{d.satellitesVisible ?? "-"}
                        </span>
                        <span className={d.armed ? "text-rose-300 font-bold" : "text-slate-500"}>
                          {d.armed ? "ARMED" : "DISARMED"}
                        </span>
                      </div>
                      <div className="mt-0.5 text-[8px] text-slate-600">
                        {d.latitude.toFixed(5)}, {d.longitude.toFixed(5)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "MARITIME" && (
              <div className="space-y-2">
                {dark?.statusMessage && (
                  <p className="text-[9.5px] text-amber-300/90 leading-snug">
                    {dark.statusMessage}
                  </p>
                )}

                <div>
                  <p className="text-[9.5px] font-bold text-slate-300 mb-1">
                    AIS GAPS ({dark?.aisGaps.length ?? 0})
                  </p>
                  {!dark || dark.aisGaps.length === 0 ? (
                    <p className="text-[9px] text-slate-500">
                      No vessel has stopped reporting while under way.
                    </p>
                  ) : (
                    dark.aisGaps.slice(0, 8).map((g) => (
                      <div
                        key={g.mmsi}
                        className="rounded border border-slate-800 bg-slate-950/60 p-1.5 mb-1"
                      >
                        <div className="flex justify-between text-[9px]">
                          <span className="text-slate-200 font-bold truncate max-w-[150px]">
                            {g.name ?? `MMSI ${g.mmsi}`}
                          </span>
                          <span
                            className={
                              g.severity === "HIGH"
                                ? "text-rose-300"
                                : g.severity === "MEDIUM"
                                ? "text-amber-300"
                                : "text-slate-400"
                            }
                          >
                            {g.gapMinutes} min
                          </span>
                        </div>
                        <div className="text-[8.5px] text-slate-500">
                          {g.flag ?? "flag unknown"} · drift {g.predictedDriftKm} km · {g.sector}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {dark && dark.reappearances.length > 0 && (
                  <div>
                    <p className="text-[9.5px] font-bold text-slate-300 mb-1">
                      REAPPEARANCES ({dark.reappearances.length})
                    </p>
                    {dark.reappearances.slice(0, 5).map((r, i) => (
                      <p key={i} className="text-[8.5px] text-slate-400 leading-snug mb-0.5">
                        {r.name ?? r.mmsi}: silent {r.gapMinutes} min, jumped {r.jumpKm} km —
                        implies {r.impliedSpeedKts} kt against {r.lastReportedSog ?? "?"} kt
                        declared
                      </p>
                    ))}
                  </div>
                )}

                <div className="pt-1.5 border-t border-slate-800">
                  <button
                    onClick={onRunSarSweep}
                    disabled={darkLoading}
                    className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-700 text-[10px] font-bold text-cyan-300 hover:border-cyan-500/60 disabled:opacity-50 flex items-center justify-center gap-1.5"
                  >
                    {darkLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Radar className="w-3 h-3" />
                    )}
                    SENTINEL-1 SAR SWEEP (current view)
                  </button>

                  {dark?.sarMessage && (
                    <p className="mt-1 text-[8.5px] text-amber-300/80 leading-snug">
                      {dark.sarMessage}
                    </p>
                  )}

                  {dark && dark.sarDetections.length > 0 && (
                    <div className="mt-1.5">
                      <p className="text-[9px] text-slate-400 mb-0.5">
                        RADAR TARGETS ({dark.sarDetections.length}) ·{" "}
                        <span className="text-rose-300">
                          {dark.sarDetections.filter((d) => d.dark).length} DARK
                        </span>
                      </p>
                      {dark.sarDetections.slice(0, 8).map((d, i) => (
                        <p
                          key={i}
                          className={`text-[8.5px] leading-snug ${
                            d.dark ? "text-rose-300" : "text-slate-400"
                          }`}
                        >
                          {d.target.latitude.toFixed(4)}, {d.target.longitude.toFixed(4)} · ~
                          {d.target.approxLengthM} m · {d.target.snrSigma}σ ·{" "}
                          {d.dark ? "NO AIS MATCH" : `${d.matchedName} (${d.matchDistanceM} m)`}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; tone?: "good" | "bad" }> = ({
  label,
  value,
  tone,
}) => (
  <div className="bg-slate-900/70 rounded px-1.5 py-1 border border-slate-800">
    <div className="text-[8px] text-slate-500">{label}</div>
    <div
      className={`font-bold ${
        tone === "bad" ? "text-rose-300" : tone === "good" ? "text-emerald-300" : "text-slate-200"
      }`}
    >
      {value}
    </div>
  </div>
);
