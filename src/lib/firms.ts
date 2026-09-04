/**
 * NASA FIRMS active-fire / thermal anomaly client.
 *
 * FIRMS republishes VIIRS and MODIS active-fire detections in near real time
 * (typically 30 minutes to 3 hours behind the satellite overpass). A free
 * MAP_KEY is required: https://firms.modaps.eosdis.nasa.gov/api/map_key/
 *
 * With no key configured the client reports NO_KEY and returns nothing.
 * It never invents a hotspot.
 */

import { ThermalAnomaly } from "@/types/intelligence";
import { describeSector } from "@/lib/regions";

// west, south, east, north
const AREA = "87.0,17.0,96.5,27.5";
const DAY_RANGE = 1;

const PRODUCTS = ["VIIRS_NOAA20_NRT", "VIIRS_SNPP_NRT", "MODIS_NRT"] as const;

interface CacheShape {
  data: ThermalAnomaly[];
  fetchedAt: number;
  error: string | null;
  productsOk: string[];
}
const globalRef = globalThis as unknown as { __aiexnetFirms?: CacheShape };
const CACHE_TTL_MS = 10 * 60 * 1000; // FIRMS updates on overpass, not per second

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(",");
    if (cells.length !== headers.length) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => (row[h] = cells[idx].trim()));
    rows.push(row);
  }
  return rows;
}

function confidenceToNumber(raw: string): number {
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, n));
  switch (raw.toLowerCase()) {
    case "h":
    case "high":
      return 90;
    case "n":
    case "nominal":
      return 65;
    case "l":
    case "low":
      return 30;
    default:
      return 0;
  }
}

/** FRP and brightness together separate a persistent industrial source from a fire. */
function classifyRisk(frp: number, brightnessK: number, dayNight: string): ThermalAnomaly["riskType"] {
  if (frp >= 50 || brightnessK >= 360) return "FOREST_FIRE";
  if (dayNight === "N" && frp >= 5) return "BORDER_ACTIVITY";
  if (frp < 5) return "AGRICULTURAL";
  return "UNCLASSIFIED";
}

async function fetchProduct(mapKey: string, product: string): Promise<ThermalAnomaly[] | null> {
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/${product}/${AREA}/${DAY_RANGE}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AIEXNET-Defense/2.0" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.startsWith("Invalid") || text.includes("MAP_KEY")) return null;

    const rows = parseCsv(text);
    return rows
      .map((r, idx): ThermalAnomaly | null => {
        const lat = Number(r.latitude);
        const lon = Number(r.longitude);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

        const brightness = Number(r.bright_ti4 ?? r.brightness ?? 0);
        const frp = Number(r.frp ?? 0);
        const acqDate = r.acq_date || "";
        const acqTime = (r.acq_time || "0000").padStart(4, "0");
        const iso = `${acqDate}T${acqTime.slice(0, 2)}:${acqTime.slice(2)}:00Z`;
        const epoch = Date.parse(iso);
        const dayNight = (r.daynight || "D").toUpperCase();

        const instrument = (r.instrument || "").toUpperCase();
        const satCode = (r.satellite || "").toUpperCase();
        let satLabel: ThermalAnomaly["satellite"] = "VIIRS";
        if (instrument === "MODIS") satLabel = "MODIS";
        else if (satCode.includes("N20") || satCode === "1") satLabel = "VIIRS_NOAA20";
        else if (satCode.includes("N21") || satCode === "2") satLabel = "VIIRS_NOAA21";

        return {
          id: `${product}-${lat.toFixed(4)}-${lon.toFixed(4)}-${acqDate}-${acqTime}-${idx}`,
          latitude: lat,
          longitude: lon,
          brightness: Number(brightness.toFixed(1)),
          confidence: confidenceToNumber(r.confidence || ""),
          satellite: satLabel,
          detectionTime: Number.isFinite(epoch) ? new Date(epoch).toISOString() : iso,
          detectionEpoch: Number.isFinite(epoch) ? epoch : undefined,
          areaDescription: describeSector(lat, lon),
          riskType: classifyRisk(frp, brightness, dayNight),
          frp: Number(frp.toFixed(1)),
          scanKm: Number(r.scan ?? 0) || undefined,
          trackKm: Number(r.track ?? 0) || undefined,
          dayNight: dayNight === "N" ? "N" : "D",
          dataSource: `NASA FIRMS / ${product}`,
        };
      })
      .filter((x): x is ThermalAnomaly => x !== null);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


export interface FirmsResult {
  data: ThermalAnomaly[];
  status: {
    id: "THERMAL";
    linkState: "LIVE" | "OFFLINE" | "NO_KEY";
    source: string;
    count: number;
    lastUpdateAgeSec: number | null;
    message: string | null;
  };
}

export async function getFirmsData(): Promise<FirmsResult> {
  const mapKey = process.env.NASA_FIRMS_MAP_KEY;
  const now = Date.now();

  if (!mapKey) {
    return {
      data: [],
      status: {
        id: "THERMAL",
        linkState: "NO_KEY",
        source: "NOT CONFIGURED",
        count: 0,
        lastUpdateAgeSec: null,
        message:
          "NASA FIRMS not configured. Get a free MAP_KEY at firms.modaps.eosdis.nasa.gov/api/map_key/ and set NASA_FIRMS_MAP_KEY.",
      },
    };
  }

  const cached = globalRef.__aiexnetFirms;
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return {
      data: cached.data,
      status: {
        id: "THERMAL",
        linkState: cached.productsOk.length > 0 ? "LIVE" : "OFFLINE",
        source: `NASA FIRMS (${cached.productsOk.join(", ") || "none"})`,
        count: cached.data.length,
        lastUpdateAgeSec: Math.round((now - cached.fetchedAt) / 1000),
        message: cached.error,
      },
    };
  }

  const all: ThermalAnomaly[] = [];
  const productsOk: string[] = [];
  const failed: string[] = [];

  for (const product of PRODUCTS) {
    const rows = await fetchProduct(mapKey, product);
    if (rows) {
      productsOk.push(product);
      all.push(...rows);
    } else {
      failed.push(product);
    }
  }

  // Newest first, and capped so the map stays usable during burning season.
  all.sort((a, b) => (b.detectionEpoch ?? 0) - (a.detectionEpoch ?? 0));
  const trimmed = all.slice(0, 2000);

  const error =
    failed.length === PRODUCTS.length
      ? "All FIRMS products failed — check that NASA_FIRMS_MAP_KEY is valid."
      : failed.length > 0
      ? `Unavailable: ${failed.join(", ")}`
      : null;

  globalRef.__aiexnetFirms = { data: trimmed, fetchedAt: now, error, productsOk };

  return {
    data: trimmed,
    status: {
      id: "THERMAL",
      linkState: productsOk.length > 0 ? "LIVE" : "OFFLINE",
      source: `NASA FIRMS (${productsOk.join(", ") || "none"})`,
      count: trimmed.length,
      lastUpdateAgeSec: 0,
      message: error,
    },
  };
}
