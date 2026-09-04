/**
 * Live TLE (orbital element set) provider.
 *
 * Element sets are fetched from CelesTrak, which republishes the US Space
 * Force space-track catalogue. TLEs decay in accuracy within days, so they
 * are refreshed on a schedule and every response carries the element-set
 * epoch and its age so the operator can see how fresh the orbit really is.
 *
 * NORAD catalogue numbers below were each verified against CelesTrak by name.
 */

export interface CatalogEntry {
  id: string;
  noradId: number;
  displayName: string;
  type:
    | "COMMUNICATION"
    | "OPTICAL_RECON"
    | "SAR_RADAR"
    | "WEATHER"
    | "SPACE_STATION"
    | "NAVIGATION"
    | "SIGINT";
  operator: string;
  note: string;
}

export const SATELLITE_CATALOG: CatalogEntry[] = [
  {
    id: "bangabandhu-1",
    noradId: 43463,
    displayName: "BANGABANDHUSAT-1",
    type: "COMMUNICATION",
    operator: "Bangladesh (BSCL)",
    note: "Bangladesh national geostationary communications satellite, 119.1°E",
  },
  {
    id: "cartosat-3",
    noradId: 44804,
    displayName: "CARTOSAT-3",
    type: "OPTICAL_RECON",
    operator: "India (ISRO)",
    note: "0.25 m panchromatic optical imaging, sun-synchronous",
  },
  {
    id: "cartosat-2f",
    noradId: 43111,
    displayName: "CARTOSAT-2F",
    type: "OPTICAL_RECON",
    operator: "India (ISRO)",
    note: "Sub-metre optical imaging, sun-synchronous",
  },
  {
    id: "risat-2br1",
    noradId: 44857,
    displayName: "RISAT-2BR1",
    type: "SAR_RADAR",
    operator: "India (ISRO)",
    note: "X-band synthetic aperture radar, all-weather day/night imaging",
  },
  {
    id: "risat-2br2",
    noradId: 46905,
    displayName: "RISAT-2BR2",
    type: "SAR_RADAR",
    operator: "India (ISRO)",
    note: "X-band synthetic aperture radar",
  },
  {
    id: "emisat",
    noradId: 44078,
    displayName: "EMISAT",
    type: "SIGINT",
    operator: "India (DRDO)",
    note: "Electronic intelligence / radar emitter mapping",
  },
  {
    id: "gsat-7a",
    noradId: 43864,
    displayName: "GSAT-7A",
    type: "COMMUNICATION",
    operator: "India (Indian Air Force)",
    note: "Dedicated military communications, geostationary",
  },
  {
    id: "gsat-7",
    noradId: 39234,
    displayName: "GSAT-7",
    type: "COMMUNICATION",
    operator: "India (Indian Navy)",
    note: "Naval communications, geostationary",
  },
  {
    id: "yaogan-30-02a",
    noradId: 42945,
    displayName: "YAOGAN-30 02A",
    type: "SIGINT",
    operator: "China (PLA SSF)",
    note: "Electronic reconnaissance triplet, 35° inclination",
  },
  {
    id: "gaofen-3",
    noradId: 41727,
    displayName: "GAOFEN-3",
    type: "SAR_RADAR",
    operator: "China (CNSA)",
    note: "C-band SAR, maritime surveillance capable",
  },
  {
    id: "sentinel-1a",
    noradId: 39634,
    displayName: "SENTINEL-1A",
    type: "SAR_RADAR",
    operator: "ESA Copernicus",
    note: "C-band SAR, open data — usable for maritime and flood analysis",
  },
  {
    id: "sentinel-2a",
    noradId: 40697,
    displayName: "SENTINEL-2A",
    type: "OPTICAL_RECON",
    operator: "ESA Copernicus",
    note: "10 m multispectral optical, open data",
  },
  {
    id: "sentinel-2c",
    noradId: 60989,
    displayName: "SENTINEL-2C",
    type: "OPTICAL_RECON",
    operator: "ESA Copernicus",
    note: "10 m multispectral optical, open data",
  },
  {
    id: "iss",
    noradId: 25544,
    displayName: "ISS (ZARYA)",
    type: "SPACE_STATION",
    operator: "International Consortium",
    note: "International Space Station",
  },
];

export interface TleRecord {
  noradId: number;
  name: string;
  line1: string;
  line2: string;
  fetchedAt: number;
}

interface TleCache {
  records: Map<number, TleRecord>;
  lastRefresh: number;
  refreshing: boolean;
  lastError: string | null;
}

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours — CelesTrak's own guidance

const globalRef = globalThis as unknown as { __aiexnetTleCache?: TleCache };

function cache(): TleCache {
  if (!globalRef.__aiexnetTleCache) {
    globalRef.__aiexnetTleCache = {
      records: new Map(),
      lastRefresh: 0,
      refreshing: false,
      lastError: null,
    };
  }
  return globalRef.__aiexnetTleCache;
}

async function fetchOne(noradId: number): Promise<TleRecord | null> {
  const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "AIEXNET-Defense/2.0 (orbital tracking)" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text || text.startsWith("No GP data")) return null;
    const lines = text.split("\n").map((l) => l.trimEnd());
    if (lines.length < 3) return null;
    if (!lines[1].startsWith("1 ") || !lines[2].startsWith("2 ")) return null;
    return {
      noradId,
      name: lines[0].trim(),
      line1: lines[1],
      line2: lines[2],
      fetchedAt: Date.now(),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/** Refresh any element sets older than the refresh interval. */
export async function refreshTles(force = false): Promise<void> {
  const c = cache();
  const now = Date.now();
  if (c.refreshing) return;
  if (!force && now - c.lastRefresh < REFRESH_INTERVAL_MS && c.records.size > 0) return;

  c.refreshing = true;
  let failures = 0;
  try {
    for (const entry of SATELLITE_CATALOG) {
      const rec = await fetchOne(entry.noradId);
      if (rec) {
        c.records.set(entry.noradId, rec);
      } else {
        failures++;
      }
      // Be a good citizen with CelesTrak.
      await new Promise((r) => setTimeout(r, 250));
    }
    c.lastRefresh = Date.now();
    c.lastError = failures > 0 ? `${failures} element set(s) unavailable` : null;
  } finally {
    c.refreshing = false;
  }
}

export function getTle(noradId: number): TleRecord | undefined {
  return cache().records.get(noradId);
}

export function tleCacheStatus() {
  const c = cache();
  return {
    count: c.records.size,
    lastRefreshAgeSec:
      c.lastRefresh > 0 ? Math.round((Date.now() - c.lastRefresh) / 1000) : null,
    lastError: c.lastError,
  };
}

/** Decode the epoch encoded in TLE line 1 columns 19-32 (YYDDD.DDDDDDDD). */
export function tleEpochDate(line1: string): Date {
  const raw = line1.substring(18, 32).trim();
  const yy = parseInt(raw.substring(0, 2), 10);
  const doy = parseFloat(raw.substring(2));
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  const start = Date.UTC(year, 0, 1);
  return new Date(start + (doy - 1) * 86400000);
}
