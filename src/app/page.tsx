"use client";

import React, { useEffect, useState } from "react";
import { UserProfile, FlightData, VesselData, SatelliteData, DefenseBase, ThermalAnomaly, ThreatAlert } from "@/types/intelligence";
import { 
  BANGLADESH_DEFENSE_BASES, 
  INITIAL_FLIGHTS, 
  INITIAL_SATELLITES, 
  INITIAL_THERMAL_ANOMALIES, 
  INITIAL_THREAT_ALERTS, 
  INITIAL_VESSELS 
} from "@/services/mockData";
import { fetchLiveFlights, fetchLiveVessels, fetchLiveSatellites } from "@/services/apiService";
import { TacticalAuthGate } from "@/components/auth/TacticalAuthGate";
import { TacticalHeader } from "@/components/hud/TacticalHeader";
import { LayerControlPanel, LayerState } from "@/components/hud/LayerControlPanel";
import { LiveThreatFeed } from "@/components/hud/LiveThreatFeed";
import { SelectedTarget, TargetInspectorModal } from "@/components/hud/TargetInspectorModal";
import { AiTacticalAssistant } from "@/components/hud/AiTacticalAssistant";
import { TacticalMap } from "@/components/map/TacticalMap";

export default function DefenseDashboard() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [defconLevel, setDefconLevel] = useState<number>(3); // DEFCON 3 (Elevated)

  // Intelligence Datasets
  const [flights, setFlights] = useState<FlightData[]>(INITIAL_FLIGHTS);
  const [vessels, setVessels] = useState<VesselData[]>(INITIAL_VESSELS);
  const [satellites, setSatellites] = useState<SatelliteData[]>(INITIAL_SATELLITES);
  const [defenseBases] = useState<DefenseBase[]>(BANGLADESH_DEFENSE_BASES);
  const [thermalAnomalies] = useState<ThermalAnomaly[]>(INITIAL_THERMAL_ANOMALIES);
  const [threatAlerts, setThreatAlerts] = useState<ThreatAlert[]>(INITIAL_THREAT_ALERTS);

  // Layer Toggles
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
    radarSweepAnim: true,
  });

  // Selected Target for Inspector Modal
  const [selectedTarget, setSelectedTarget] = useState<SelectedTarget | null>(null);

  // Camera Fly-To state
  const [flyToLocation, setFlyToLocation] = useState<{
    lng: number;
    lat: number;
    zoom: number;
    pitch?: number;
  } | null>(null);

  // Live Intelligence Data Polling Loop
  useEffect(() => {
    if (!user) return;

    const pollInterval = setInterval(async () => {
      try {
        const [updatedFlights, updatedVessels, updatedSats] = await Promise.all([
          fetchLiveFlights(),
          fetchLiveVessels(),
          fetchLiveSatellites(),
        ]);
        setFlights(updatedFlights);
        setVessels(updatedVessels);
        setSatellites(updatedSats);
      } catch (err) {
        console.warn("Periodic intelligence telemetry sync error:", err);
      }
    }, 4500);

    return () => clearInterval(pollInterval);
  }, [user]);

  const handleToggleLayer = (key: keyof LayerState) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleFlyTo = (preset: 'BD_ALL' | 'BAY_OF_BENGAL' | 'DHAKA_AIR' | 'BORDER_SECTOR' | 'GLOBAL') => {
    switch (preset) {
      case 'BD_ALL':
        setFlyToLocation({ lng: 90.3563, lat: 23.6850, zoom: 6.5, pitch: 30 });
        break;
      case 'BAY_OF_BENGAL':
        setFlyToLocation({ lng: 91.2000, lat: 20.8000, zoom: 7.2, pitch: 45 });
        break;
      case 'DHAKA_AIR':
        setFlyToLocation({ lng: 90.3978, lat: 23.8433, zoom: 10.5, pitch: 40 });
        break;
      case 'BORDER_SECTOR':
        setFlyToLocation({ lng: 92.3500, lat: 21.2000, zoom: 8.5, pitch: 45 });
        break;
      case 'GLOBAL':
        setFlyToLocation({ lng: 90.0000, lat: 20.0000, zoom: 3.5, pitch: 10 });
        break;
    }
  };

  const handleLocateCoordinates = (coords: [number, number]) => {
    setFlyToLocation({ lng: coords[0], lat: coords[1], zoom: 9.0, pitch: 40 });
  };

  return (
    <main className="relative w-screen h-screen overflow-hidden bg-tactical-dark">
      {/* 1. Tactical Command Login Gate if not authenticated */}
      {!user && <TacticalAuthGate onAuthenticated={setUser} />}

      {/* 2. Top Tactical Command Header */}
      {user && (
        <TacticalHeader
          user={user}
          defconLevel={defconLevel}
          onDefconChange={setDefconLevel}
          airCount={flights.length}
          seaCount={vessels.length}
          satCount={satellites.length}
          thermalCount={thermalAnomalies.length}
          onFlyTo={handleFlyTo}
          onLogout={() => setUser(null)}
        />
      )}

      {/* 3. Main 3D Tactical Map Canvas */}
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

        {/* Floating Layer Controls (Top Left) */}
        {user && (
          <div className="absolute top-4 left-4 z-20">
            <LayerControlPanel layers={layers} onToggleLayer={handleToggleLayer} />
          </div>
        )}

        {/* Floating Live Threat Stream (Top Right) */}
        {user && (
          <div className="absolute top-4 right-4 z-20">
            <LiveThreatFeed
              alerts={threatAlerts}
              onSelectCoordinates={handleLocateCoordinates}
            />
          </div>
        )}

        {/* Target Inspector Popup (Bottom Right) */}
        <TargetInspectorModal
          target={selectedTarget}
          onClose={() => setSelectedTarget(null)}
        />

        {/* AI Tactical Intelligence Copilot (Bottom Left) */}
        {user && <AiTacticalAssistant />}
      </div>

      {/* CRT Scanline Shader */}
      <div className="absolute inset-0 crt-overlay pointer-events-none" />
    </main>
  );
}
