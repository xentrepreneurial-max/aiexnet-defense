import { FlightData, SatelliteData, ThreatAlert, VesselData, ThermalAnomaly } from "@/types/intelligence";
import { INITIAL_FLIGHTS, INITIAL_SATELLITES, INITIAL_THERMAL_ANOMALIES, INITIAL_THREAT_ALERTS, INITIAL_VESSELS } from "./mockData";

// Bounding box for Bangladesh and surrounding South Asia (lamin, lomin, lamax, lomax)
const BD_BBOX = {
  lamin: 19.5,
  lomin: 87.0,
  lamax: 27.5,
  lomax: 93.5,
};

export async function fetchLiveFlights(): Promise<FlightData[]> {
  try {
    const url = `https://opensky-network.org/api/states/all?lamin=${BD_BBOX.lamin}&lomin=${BD_BBOX.lomin}&lamax=${BD_BBOX.lamax}&lomax=${BD_BBOX.lomax}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000); // 4s timeout

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      if (data && data.states && Array.isArray(data.states)) {
        const liveFlights: FlightData[] = data.states
          .filter((s: any[]) => s[5] !== null && s[6] !== null) // valid lon, lat
          .map((s: any[]) => {
            const callsign = (s[1] || "UNIDENTIFIED").trim();
            const isMil = callsign.startsWith("BAF") || callsign.startsWith("IAF") || callsign.startsWith("MAF") || s[8] === true;
            return {
              icao24: s[0] || "unknown",
              callsign: callsign || "UNKNOWN",
              origin_country: s[2] || "International",
              longitude: s[5],
              latitude: s[6],
              baro_altitude: s[7] || 0,
              velocity: s[9] || 0,
              true_track: s[10] || 0,
              vertical_rate: s[11] || 0,
              squawk: s[14] || "---",
              on_ground: s[8] || false,
              category: isMil ? "MILITARY" : "COMMERCIAL",
              threatLevel: isMil ? "ELEVATED" : "NORMAL",
              lastContact: s[4] ? s[4] * 1000 : Date.now(),
            };
          });

        if (liveFlights.length > 0) {
          // Merge with specialized military tracks
          return [...liveFlights, ...INITIAL_FLIGHTS.filter(f => f.category === 'MILITARY')];
        }
      }
    }
  } catch (err) {
    console.warn("Live OpenSky API unavailable or rate-limited. Using tactical fallback stream:", err);
  }

  // Live simulation jitter on fallback flights to simulate real-time movement
  return INITIAL_FLIGHTS.map((f) => {
    const speedDeg = (f.velocity * 0.000005) || 0.0005;
    const rad = (f.true_track * Math.PI) / 180;
    return {
      ...f,
      latitude: f.latitude + Math.cos(rad) * speedDeg,
      longitude: f.longitude + Math.sin(rad) * speedDeg,
      lastContact: Date.now(),
    };
  });
}

export async function fetchLiveVessels(): Promise<VesselData[]> {
  // Simulates realistic continuous vessel movement in Bay of Bengal
  return INITIAL_VESSELS.map((v) => {
    const speedDeg = (v.speed * 0.000003);
    const rad = (v.heading * Math.PI) / 180;
    return {
      ...v,
      latitude: v.latitude + Math.cos(rad) * speedDeg,
      longitude: v.longitude + Math.sin(rad) * speedDeg,
    };
  });
}

export async function fetchLiveSatellites(): Promise<SatelliteData[]> {
  return INITIAL_SATELLITES.map((sat) => {
    // Increment orbital position along orbit
    const deltaLat = sat.type === 'COMMUNICATION' ? 0 : 0.02;
    const deltaLon = sat.type === 'COMMUNICATION' ? 0 : 0.015;
    return {
      ...sat,
      latitude: ((sat.latitude + deltaLat + 90) % 180) - 90,
      longitude: ((sat.longitude + deltaLon + 180) % 360) - 180,
    };
  });
}

export async function fetchThermalAnomalies(): Promise<ThermalAnomaly[]> {
  return INITIAL_THERMAL_ANOMALIES;
}

export async function fetchThreatAlerts(): Promise<ThreatAlert[]> {
  return INITIAL_THREAT_ALERTS;
}
