import { FlightData, SatelliteData, ThreatAlert, VesselData, ThermalAnomaly } from "@/types/intelligence";
import { INITIAL_FLIGHTS, INITIAL_SATELLITES, INITIAL_THERMAL_ANOMALIES, INITIAL_THREAT_ALERTS, INITIAL_VESSELS } from "./mockData";

// Internal persistent vector store to guarantee 60fps aerodynamic smoothing without resetting loops
let persistentFlightTracks: Map<string, FlightData> = new Map();
let persistentVesselTracks: Map<string, VesselData> = new Map();

export async function fetchLiveFlights(): Promise<FlightData[]> {
  try {
    const res = await fetch("/api/defense/flights", {
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data) && json.data.length > 0) {
        // Update persistent track positions
        json.data.forEach((f: FlightData) => {
          persistentFlightTracks.set(f.icao24, f);
        });
        return json.data;
      }
    }
  } catch (err) {
    console.warn("Internal Flight API query fallback to continuous telemetry:", err);
  }

  // Smooth continuous progression if network fails
  if (persistentFlightTracks.size === 0) {
    INITIAL_FLIGHTS.forEach((f) => persistentFlightTracks.set(f.icao24, f));
  }

  const updated: FlightData[] = [];
  persistentFlightTracks.forEach((f, key) => {
    const speedDeg = (f.velocity * 0.0000035) || 0.00035;
    const rad = (f.true_track * Math.PI) / 180;
    const newLat = Number((f.latitude + Math.cos(rad) * speedDeg).toFixed(4));
    const newLon = Number((f.longitude + Math.sin(rad) * speedDeg).toFixed(4));

    const updatedFlight: FlightData = {
      ...f,
      latitude: newLat,
      longitude: newLon,
      lastContact: Date.now(),
    };
    persistentFlightTracks.set(key, updatedFlight);
    updated.push(updatedFlight);
  });

  return updated;
}

export async function fetchLiveVessels(): Promise<VesselData[]> {
  if (persistentVesselTracks.size === 0) {
    INITIAL_VESSELS.forEach((v) => persistentVesselTracks.set(v.mmsi, v));
  }

  const updated: VesselData[] = [];
  persistentVesselTracks.forEach((v, key) => {
    const speedDeg = (v.speed * 0.000002) || 0.00002;
    const rad = (v.heading * Math.PI) / 180;
    const newLat = Number((v.latitude + Math.cos(rad) * speedDeg).toFixed(4));
    const newLon = Number((v.longitude + Math.sin(rad) * speedDeg).toFixed(4));

    const updatedVessel: VesselData = {
      ...v,
      latitude: newLat,
      longitude: newLon,
    };
    persistentVesselTracks.set(key, updatedVessel);
    updated.push(updatedVessel);
  });

  return updated;
}

export async function fetchLiveSatellites(): Promise<SatelliteData[]> {
  try {
    const res = await fetch("/api/defense/satellites", {
      cache: "no-store",
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.data && Array.isArray(json.data) && json.data.length > 0) {
        return json.data;
      }
    }
  } catch (err) {
    console.warn("Satellite SGP4 API query fallback:", err);
  }

  // Fallback
  return INITIAL_SATELLITES;
}

export async function fetchThermalAnomalies(): Promise<ThermalAnomaly[]> {
  return INITIAL_THERMAL_ANOMALIES;
}

export async function fetchThreatAlerts(): Promise<ThreatAlert[]> {
  return INITIAL_THREAT_ALERTS;
}
