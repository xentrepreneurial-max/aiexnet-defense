"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  UserProfile,
  FlightData,
  VesselData,
  SatelliteData,
  DefenseBase,
  ThermalAnomaly,
  ThreatAlert,
  FeedStatus,
} from "@/types/intelligence";
import { BANGLADESH_DEFENSE_BASES } from "@/services/referenceData";
import {
  fetchLiveFlights,
  fetchLiveVessels,
  fetchLiveSatellites,
  fetchThermalAnomalies,
  fetchThreatAlerts,
  fetchDrones,
  fetchArchiveStats,
  fetchReplayAt,
  fetchDarkVessels,
  planMission,
  replayToFlights,
  replayToVessels,
} from "@/services/apiService";
import { TacticalAuthGate } from "@/components/auth/TacticalAuthGate";
import { TacticalHeader } from "@/components/hud/TacticalHeader";
import { LayerControlPanel, LayerState } from "@/components/hud/LayerControlPanel";
import { LiveThreatFeed } from "@/components/hud/LiveThreatFeed";
import { SelectedTarget, TargetInspectorModal } from "@/components/hud/TargetInspectorModal";
import { AiTacticalAssistant } from "@/components/hud/AiTacticalAssistant";
import { FeedStatusBar } from "@/components/hud/FeedStatusBar";
import { TimeScrubber, ReplayState } from "@/components/hud/TimeScrubber";
import {
  OperationsDock,
  PlannerWaypoint,
  MissionAnalysisView,
  DroneView,
  DarkVesselView,
} from "@/components/hud/OperationsDock";
import { TacticalMap, MissionOverlay } from "@/components/map/TacticalMap";

/** Poll cadences matched to how fast each source actually changes. */
const AIR_POLL_MS = 2000;
const SEA_POLL_MS = 5000;
const SPACE_POLL_MS = 5000;
const THERMAL_POLL_MS = 120000;
const ALERT_POLL_MS = 6000;
const DRONE_POLL_MS = 1500;
const ARCHIVE_STATS_POLL_MS = 10000;
const DARK_POLL_MS = 60000;
const REPLAY_FETCH_MS = 700;

const UNKNOWN_STATUS = (id: string): FeedStatus => ({
  id,
  linkState: "OFFLINE",
  source: "INITIALISING",
  count: 0,
  lastUpdateAgeSec: null,
  message: "Waiting for first poll.",
});

export default function DefenseDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [defconLevel, setDefconLevel] = useState<number>(3);

  // Live datasets start EMPTY. Anything on the map came from a feed.
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [vessels, setVessels] = useState<VesselData[]>([]);
  const [satellites, setSatellites] = useState<SatelliteData[]>([]);
  const [thermalAnomalies, setThermalAnomalies] = useState<ThermalAnomaly[]>([]);
  const [threatAlerts, setThreatAlerts] = useState<ThreatAlert[]>([]);
  const [drones, setDrones] = useState<DroneView[]>([]);
  const [droneMessage, setDroneMessage] = useState<string | null>(null);
  const [defenseBases] = useState<DefenseBase[]>(BANGLADESH_DEFENSE_BASES);

  const [feedStatus, setFeedStatus] = useState<Record<string, FeedStatus>>({
    AIR: UNKNOWN_STATUS("AIR"),
    SEA: UNKNOWN_STATUS("SEA"),
    SPACE: UNKNOWN_STATUS("SPACE"),
    THERMAL: UNKNOWN_STATUS("THERMAL"),
    ALERTS: UNKNOWN_STATUS("ALERTS"),
    UAV: UNKNOWN_STATUS("UAV"),
  });

  const applyStatus = useCallback((s: FeedStatus) => {
    setFeedStatus((prev) => ({ ...prev, [s.id]: s }));
  }, []);

  // --- Replay ---------------------------------------------------------------
  const [replay, setReplay] = useState<ReplayState>({
    mode: "LIVE",
    atMs: Date.now(),
    playing: false,
    speed: 4,
    bounds: null,
    recordedCount: 0,
    archiveMessage: null,
  });
  const [replayFlights, setReplayFlights] = useState<FlightData[]>([]);
  const [replayVessels, setReplayVessels] = useState<VesselData[]>([]);

  const updateReplay = useCallback((patch: Partial<ReplayState>) => {
    setReplay((prev) => ({ ...prev, ...patch }));
  }, []);

  // --- Mission planning -----------------------------------------------------
  const [planningMode, setPlanningMode] = useState(false);
  const [waypoints, setWaypoints] = useState<PlannerWaypoint[]>([]);
  const [analysis, setAnalysis] = useState<MissionAnalysisView | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [planJson, setPlanJson] = useState<unknown | null>(null);
  const [geofenceRing, setGeofenceRing] = useState<Array<[number, number]> | null>(null);
  const [missionConflicts, setMissionConflicts] = useState<
    Array<{ latitude: number; longitude: number; severity: string; callsign: string }>
  >([]);

  // --- Dark vessels ---------------------------------------------------------
  const [dark, setDark] = useState<DarkVesselView | null>(null);
  const [darkLoading, setDarkLoading] = useState(false);
  const viewportRef = useRef<[number, number, number, number] | null>(null);

  const [layers, setLayers] = useState<LayerState>({
    showFlights: true,
    showVessels: true,
    showSatellites: true,
    showDefenseBases: true,
    showRadarRings: true,
    showMissileRings: true,
    showADIZ: true,
    showEEZ: true,
    showThermal: true,
    showTrails: true,
    radarSweepAnim: true,
  });

  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);
  const [flyToLocation, setFlyToLocation] = useState<{
    lng: number;
    lat: number;
    zoom: number;
    pitch?: number;
  } | null>(null);

  const inFlight = useRef<Record<string, boolean>>({});

  // --- Live feed polling ----------------------------------------------------
  useEffect(() => {
    if (!user) return;

    const runners: Array<{ key: string; ms: number; run: () => Promise<void> }> = [
      {
        key: "AIR",
        ms: AIR_POLL_MS,
        run: async () => {
          const { data, status } = await fetchLiveFlights();
          setFlights(data);
          applyStatus(status);
        },
      },
      {
        key: "SEA",
        ms: SEA_POLL_MS,
        run: async () => {
          const { data, status } = await fetchLiveVessels();
          setVessels(data);
          applyStatus(status);
        },
      },
      {
        key: "SPACE",
        ms: SPACE_POLL_MS,
        run: async () => {
          const { data, status } = await fetchLiveSatellites();
          setSatellites(data);
          applyStatus(status);
        },
      },
      {
        key: "THERMAL",
        ms: THERMAL_POLL_MS,
        run: async () => {
          const { data, status } = await fetchThermalAnomalies();
          setThermalAnomalies(data);
          applyStatus(status);
        },
      },
      {
        key: "ALERTS",
        ms: ALERT_POLL_MS,
        run: async () => {
          const { data, status } = await fetchThreatAlerts();
          setThreatAlerts(data);
          applyStatus(status);
        },
      },
      {
        key: "UAV",
        ms: DRONE_POLL_MS,
        run: async () => {
          const { data, status } = await fetchDrones();
          setDrones(data);
          setDroneMessage(status.message);
          applyStatus(status);
        },
      },
      {
        key: "ARCHIVE",
        ms: ARCHIVE_STATS_POLL_MS,
        run: async () => {
          const stats = await fetchArchiveStats();
          updateReplay({
            bounds: stats.bounds,
            recordedCount: stats.recordedCount,
            archiveMessage: stats.message,
          });
        },
      },
      {
        key: "DARK",
        ms: DARK_POLL_MS,
        run: async () => {
          const result = await fetchDarkVessels();
          setDark((prev) => ({
            ...result,
            // Keep the last SAR sweep visible; it is operator-initiated.
            sarDetections: prev?.sarDetections ?? result.sarDetections,
            sarLinkState: prev?.sarLinkState ?? result.sarLinkState,
            sarMessage: prev?.sarMessage ?? result.sarMessage,
          }));
        },
      },
    ];

    const timers = runners.map(({ key, ms, run }) => {
      const tick = async () => {
        if (inFlight.current[key]) return;
        inFlight.current[key] = true;
        try {
          await run();
        } finally {
          inFlight.current[key] = false;
        }
      };
      void tick();
      return setInterval(tick, ms);
    });

    return () => timers.forEach(clearInterval);
  }, [user, applyStatus, updateReplay]);

  // --- Replay fetching ------------------------------------------------------
  useEffect(() => {
    if (!user || replay.mode !== "REPLAY") return;

    let cancelled = false;
    const tick = async () => {
      if (inFlight.current.REPLAY) return;
      inFlight.current.REPLAY = true;
      try {
        const picture = await fetchReplayAt(replayAtRef.current);
        if (cancelled) return;
        setReplayFlights(replayToFlights(picture.air));
        setReplayVessels(replayToVessels(picture.sea));
      } finally {
        inFlight.current.REPLAY = false;
      }
    };

    void tick();
    const timer = setInterval(tick, REPLAY_FETCH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, replay.mode]);

  const replayAtRef = useRef(replay.atMs);
  useEffect(() => {
    replayAtRef.current = replay.atMs;
  }, [replay.atMs]);

  // --- Mission analysis (debounced on waypoint edits) -----------------------
  useEffect(() => {
    if (waypoints.length < 2) {
      setAnalysis(null);
      setPlanJson(null);
      setGeofenceRing(null);
      setMissionConflicts([]);
      return;
    }

    const handle = setTimeout(async () => {
      setAnalysing(true);
      try {
        const result = await planMission(waypoints);
        setAnalysis(result.analysis);
        setPlanJson(result.qgcPlan);
        setGeofenceRing(result.geofenceRing);
        setMissionConflicts(result.conflictMarkers);
      } finally {
        setAnalysing(false);
      }
    }, 400);

    return () => clearTimeout(handle);
  }, [waypoints]);

  // --- Handlers -------------------------------------------------------------
  const handleMapClick = useCallback(
    ({ lng, lat }: { lng: number; lat: number }) => {
      if (!planningMode) return;
      setWaypoints((prev) => [
        ...prev,
        {
          latitude: Number(lat.toFixed(6)),
          longitude: Number(lng.toFixed(6)),
          altitudeM: prev.length === 0 ? 0 : 3000,
          action: prev.length === 0 ? "TAKEOFF" : "WAYPOINT",
        },
      ]);
    },
    [planningMode]
  );

  const handleRunSarSweep = useCallback(async () => {
    const bbox = viewportRef.current;
    if (!bbox) return;
    setDarkLoading(true);
    try {
      const result = await fetchDarkVessels(bbox);
      setDark(result);
    } finally {
      setDarkLoading(false);
    }
  }, []);

  const handleToggleLayer = (key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFlyTo = (
    preset: "BD_ALL" | "BAY_OF_BENGAL" | "DHAKA_AIR" | "BORDER_SECTOR" | "GLOBAL"
  ) => {
    switch (preset) {
      case "BD_ALL":
        setFlyToLocation({ lng: 90.3563, lat: 23.685, zoom: 6.5, pitch: 30 });
        break;
      case "BAY_OF_BENGAL":
        setFlyToLocation({ lng: 91.2, lat: 20.8, zoom: 7.2, pitch: 45 });
        break;
      case "DHAKA_AIR":
        setFlyToLocation({ lng: 90.3978, lat: 23.8433, zoom: 10.5, pitch: 40 });
        break;
      case "BORDER_SECTOR":
        setFlyToLocation({ lng: 92.35, lat: 21.2, zoom: 8.5, pitch: 45 });
        break;
      case "GLOBAL":
        setFlyToLocation({ lng: 90.0, lat: 20.0, zoom: 3.5, pitch: 10 });
        break;
    }
  };

  const handleLocateCoordinates = (coords: [number, number]) => {
    setFlyToLocation({ lng: coords[0], lat: coords[1], zoom: 9.0, pitch: 40 });
  };

  // --- Derived --------------------------------------------------------------
  const isReplay = replay.mode === "REPLAY";
  const shownFlights = isReplay ? replayFlights : flights;
  const shownVessels = isReplay ? replayVessels : vessels;

  const mission: MissionOverlay | null = useMemo(
    () =>
      waypoints.length > 0
        ? { waypoints, geofenceRing, conflicts: missionConflicts }
        : null,
    [waypoints, geofenceRing, missionConflicts]
  );

  const replayStatus: Record<string, FeedStatus> = useMemo(() => {
    if (!isReplay) return feedStatus;
    const frozen: FeedStatus = {
      id: "AIR",
      linkState: "DEGRADED",
      source: "LOCAL ARCHIVE (replay)",
      count: replayFlights.length,
      lastUpdateAgeSec: Math.round((Date.now() - replay.atMs) / 1000),
      message: "Replaying recorded observations. Live feeds are still running underneath.",
    };
    return {
      ...feedStatus,
      AIR: frozen,
      SEA: { ...frozen, id: "SEA", count: replayVessels.length },
    };
  }, [isReplay, feedStatus, replayFlights.length, replayVessels.length, replay.atMs]);

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-tactical-dark">
      {!user && <TacticalAuthGate onAuthenticated={setUser} />}

      {user && (
        <TacticalHeader
          user={user}
          defconLevel={defconLevel}
          onDefconChange={setDefconLevel}
          airCount={shownFlights.length}
          seaCount={shownVessels.length}
          satCount={satellites.length}
          thermalCount={thermalAnomalies.length}
          feedStatus={replayStatus}
          onFlyTo={handleFlyTo}
          onLogout={() => setUser(null)}
        />
      )}

      <div className="relative w-full h-[calc(100vh-64px)]">
        <TacticalMap
          flights={shownFlights}
          vessels={shownVessels}
          satellites={satellites}
          defenseBases={defenseBases}
          thermalAnomalies={thermalAnomalies}
          drones={drones}
          mission={mission}
          planningMode={planningMode}
          onMapClick={handleMapClick}
          onViewportChange={(bbox) => {
            viewportRef.current = bbox;
          }}
          layers={layers}
          onSelectTarget={setSelectedTarget}
          flyToLocation={flyToLocation}
        />

        {user && (
          <div className="absolute top-4 left-4 bottom-32 z-20 flex flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin">
            <FeedStatusBar statuses={replayStatus} />
            <LayerControlPanel layers={layers} onToggleLayer={handleToggleLayer} />
          </div>
        )}

        {user && (
          <div className="absolute top-4 right-4 bottom-32 z-20 flex flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin items-end">
            <TargetInspectorModal
              target={selectedTarget}
              onClose={() => setSelectedTarget(null)}
            />
            <LiveThreatFeed
              alerts={threatAlerts}
              status={feedStatus.ALERTS}
              onSelectCoordinates={handleLocateCoordinates}
            />
            <OperationsDock
              planningMode={planningMode}
              onTogglePlanning={() => setPlanningMode((v) => !v)}
              waypoints={waypoints}
              onUpdateWaypoint={(i, patch) =>
                setWaypoints((prev) => prev.map((w, idx) => (idx === i ? { ...w, ...patch } : w)))
              }
              onRemoveWaypoint={(i) => setWaypoints((prev) => prev.filter((_, idx) => idx !== i))}
              onClearMission={() => {
                setWaypoints([]);
                setPlanningMode(false);
              }}
              onAppendReturn={() =>
                setWaypoints((prev) =>
                  prev.length === 0
                    ? prev
                    : [
                        ...prev,
                        {
                          latitude: prev[0].latitude,
                          longitude: prev[0].longitude,
                          altitudeM: 0,
                          action: "RTL",
                        },
                      ]
                )
              }
              analysis={analysis}
              analysing={analysing}
              planJson={planJson}
              drones={drones}
              droneMessage={droneMessage}
              dark={dark}
              darkLoading={darkLoading}
              onRunSarSweep={handleRunSarSweep}
            />
          </div>
        )}

        {user && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
            <TimeScrubber state={replay} onChange={updateReplay} />
          </div>
        )}

        {user && <AiTacticalAssistant onSelectCoordinates={handleLocateCoordinates} />}
      </div>

      <div className="absolute inset-0 crt-overlay pointer-events-none" />
    </main>
  );
}
