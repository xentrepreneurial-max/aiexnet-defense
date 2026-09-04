import {
  FlightData,
  SatelliteData,
  ThreatAlert,
  VesselData,
  ThermalAnomaly,
  FeedStatus,
} from "@/types/intelligence";

/**
 * Client-side feed access.
 *
 * These helpers never substitute synthetic data. If a feed is down the caller
 * receives an empty array plus a FeedStatus explaining why, and the HUD shows
 * that state instead of a comfortable-looking but false picture.
 */

export interface FeedResult<T> {
  data: T[];
  status: FeedStatus;
}

const OFFLINE_STATUS = (id: string, message: string): FeedStatus => ({
  id,
  linkState: "OFFLINE",
  source: "UNREACHABLE",
  count: 0,
  lastUpdateAgeSec: null,
  message,
});

async function getFeed<T>(path: string, id: string): Promise<FeedResult<T>> {
  try {
    const res = await fetch(path, { cache: "no-store" });
    if (!res.ok) {
      return { data: [], status: OFFLINE_STATUS(id, `Server returned HTTP ${res.status}`) };
    }
    const json = await res.json();
    const data: T[] = Array.isArray(json?.data) ? json.data : [];
    const status: FeedStatus = json?.status ?? OFFLINE_STATUS(id, "No status reported");
    return { data, status };
  } catch (err: any) {
    return {
      data: [],
      status: OFFLINE_STATUS(id, `Cannot reach local API: ${err?.message ?? err}`),
    };
  }
}

export const fetchLiveFlights = () => getFeed<FlightData>("/api/defense/flights", "AIR");
export const fetchLiveVessels = () => getFeed<VesselData>("/api/defense/vessels", "SEA");
export const fetchLiveSatellites = () =>
  getFeed<SatelliteData>("/api/defense/satellites", "SPACE");
export const fetchThermalAnomalies = () =>
  getFeed<ThermalAnomaly>("/api/defense/thermal", "THERMAL");
export const fetchThreatAlerts = () => getFeed<ThreatAlert>("/api/defense/alerts", "ALERTS");
