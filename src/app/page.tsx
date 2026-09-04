"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
} from "@/services/apiService";
import { TacticalAuthGate } from "@/components/auth/TacticalAuthGate";
import { TacticalHeader } from "@/components/hud/TacticalHeader";
import { LayerControlPanel, LayerState } from "@/components/hud/LayerControlPanel";
import { LiveThreatFeed } from "@/components/hud/LiveThreatFeed";
import { SelectedTarget, TargetInspectorModal } from "@/components/hud/TargetInspectorModal";
import { AiTacticalAssistant } from "@/components/hud/AiTacticalAssistant";
import { FeedStatusBar } from "@/components/hud/FeedStatusBar";
import { TacticalMap } from "@/components/map/TacticalMap";

/** Poll cadences matched to how fast each source actually changes. */
const AIR_POLL_MS = 2000; // server sweeps all coverage points every ~6.6 s
const SEA_POLL_MS = 5000;
const SPACE_POLL_MS = 5000;
const THERMAL_POLL_MS = 120000; // FIRMS updates per satellite overpass
const ALERT_POLL_MS = 6000;

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

  // Intelligence datasets start EMPTY. Anything on the map came from a feed.
  const [flights, setFlights] = useState<FlightData[]>([]);
  const [vessels, setVessels] = useState<VesselData[]>([]);
  const [satellites, setSatellites] = useState<SatelliteData[]>([]);
  const [thermalAnomalies, setThermalAnomalies] = useState<ThermalAnomaly[]>([]);
  const [threatAlerts, setThreatAlerts] = useState<ThreatAlert[]>([]);
  const [defenseBases] = useState<DefenseBase[]>(BANGLADESH_DEFENSE_BASES);

  const [feedStatus, setFeedStatus] = useState<Record<string, FeedStatus>>({
    AIR: UNKNOWN_STATUS("AIR"),
    SEA: UNKNOWN_STATUS("SEA"),
    SPACE: UNKNOWN_STATUS("SPACE"),
    THERMAL: UNKNOWN_STATUS("THERMAL"),
    ALERTS: UNKNOWN_STATUS("ALERTS"),
  });

  const applyStatus = useCallback((s: FeedStatus) => {
    setFeedStatus((prev) => ({ ...prev, [s.id]: s }));
  }, []);

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

  // Each feed polls on its own cadence so a slow one never stalls the others.
  const inFlight = useRef<Record<string, boolean>>({});

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
    ];

    const timers = runners.map(({ key, ms, run }) => {
      const tick = async () => {
        if (inFlight.current[key]) return; // never stack requests
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
  }, [user, applyStatus]);

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

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-tactical-dark">
      {!user && <TacticalAuthGate onAuthenticated={setUser} />}

      {user && (
        <TacticalHeader
          user={user}
          defconLevel={defconLevel}
          onDefconChange={setDefconLevel}
          airCount={flights.length}
          seaCount={vessels.length}
          satCount={satellites.length}
          thermalCount={thermalAnomalies.length}
          feedStatus={feedStatus}
          onFlyTo={handleFlyTo}
          onLogout={() => setUser(null)}
        />
      )}

      <div className="relative w-full h-[calc(100vh-64px)]">
        <TacticalMap
          flights={flights}
          vessels={vessels}
          satellites={satellites}
          defenseBases={defenseBases}
          thermalAnomalies={thermalAnomalies}
          layers={layers}
          onSelectTarget={setSelectedTarget}
          flyToLocation={flyToLocation}
        />

        {user && (
          <div className="absolute top-4 left-4 bottom-24 z-20 flex flex-col gap-3 overflow-y-auto pr-1 scrollbar-thin">
            <FeedStatusBar statuses={feedStatus} />
            <LayerControlPanel layers={layers} onToggleLayer={handleToggleLayer} />
          </div>
        )}

        {user && (
          <div className="absolute top-4 right-4 z-20">
            <LiveThreatFeed
              alerts={threatAlerts}
              status={feedStatus.ALERTS}
              onSelectCoordinates={handleLocateCoordinates}
            />
          </div>
        )}

        <TargetInspectorModal target={selectedTarget} onClose={() => setSelectedTarget(null)} />

        {user && <AiTacticalAssistant onSelectCoordinates={handleLocateCoordinates} />}
      </div>

      <div className="absolute inset-0 crt-overlay pointer-events-none" />
    </main>
  );
}
