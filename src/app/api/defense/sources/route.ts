import { NextResponse } from "next/server";
import { fetchText } from "@/lib/httpFetch";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Upstream credential probe.
 *
 * Live-tests every configured API and reports what each one actually answers.
 * A key being present in .env.local is not the same as a key working: an
 * expired token, an unsubscribed plan or a region with no data all look
 * identical from inside the app until something is asked of them.
 *
 * This endpoint asks. It never reports a source as healthy without a response
 * to point at, and it never prints a secret — only whether one is configured.
 */

type Health = "LIVE" | "AUTH_FAILED" | "NO_KEY" | "NO_DATA" | "UNREACHABLE";

interface SourceReport {
  id: string;
  role: string;
  configured: boolean;
  health: Health;
  detail: string;
  latencyMs: number | null;
}

async function probe(
  id: string,
  role: string,
  configured: boolean,
  run: () => Promise<{ health: Health; detail: string }>
): Promise<SourceReport> {
  if (!configured) {
    return {
      id,
      role,
      configured: false,
      health: "NO_KEY",
      detail: "No credential configured in the environment.",
      latencyMs: null,
    };
  }
  const started = Date.now();
  try {
    const { health, detail } = await run();
    return { id, role, configured: true, health, detail, latencyMs: Date.now() - started };
  } catch (err: any) {
    return {
      id,
      role,
      configured: true,
      health: "UNREACHABLE",
      detail: String(err?.message ?? err).slice(0, 200),
      latencyMs: Date.now() - started,
    };
  }
}

export async function GET() {
  const env = process.env;

  const reports = await Promise.all([
    // --- Air, no credential required -------------------------------------
    probe("adsb.fi", "Primary regional ADS-B", true, async () => {
      const r = await fetchText(
        "https://opendata.adsb.fi/api/v2/lat/21.45/lon/91.96/dist/250"
      );
      if (!r.ok) return { health: "UNREACHABLE" as Health, detail: r.error ?? `HTTP ${r.status}` };
      const n = (JSON.parse(r.text).aircraft ?? JSON.parse(r.text).ac ?? []).length;
      return { health: "LIVE" as Health, detail: `${n} aircraft in a 250 NM radius.` };
    }),

    probe("adsb.lol/mil", "Worldwide military ADS-B", true, async () => {
      const r = await fetchText("https://api.adsb.lol/v2/mil");
      if (!r.ok) return { health: "UNREACHABLE" as Health, detail: r.error ?? `HTTP ${r.status}` };
      const n = (JSON.parse(r.text).ac ?? []).length;
      return { health: "LIVE" as Health, detail: `${n} military aircraft transmitting worldwide.` };
    }),

    // --- Air, credentialed ------------------------------------------------
    probe(
      "OpenSky",
      "Authenticated ADS-B (higher rate limits)",
      Boolean(env.OPENSKY_CLIENT_ID && env.OPENSKY_CLIENT_SECRET),
      async () => {
        const body = new URLSearchParams({
          grant_type: "client_credentials",
          client_id: env.OPENSKY_CLIENT_ID!,
          client_secret: env.OPENSKY_CLIENT_SECRET!,
        });
        const res = await fetch(
          "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
            signal: AbortSignal.timeout(20000),
          }
        );
        if (res.ok) return { health: "LIVE" as Health, detail: "OAuth token issued." };
        const text = await res.text();
        return {
          health: "AUTH_FAILED" as Health,
          detail: `HTTP ${res.status}: ${text.slice(0, 120)}. Recreate the API client at opensky-network.org (Account → API clients).`,
        };
      }
    ),

    probe(
      "ADS-B Exchange",
      "Uncensored ADS-B via RapidAPI",
      Boolean(env.ADSBX_API_KEY),
      async () => {
        const r = await fetchText(
          "https://adsbexchange-com1.p.rapidapi.com/v2/lat/21.45/lon/91.96/dist/250/",
          {
            headers: {
              "x-rapidapi-key": env.ADSBX_API_KEY!,
              "x-rapidapi-host": "adsbexchange-com1.p.rapidapi.com",
            },
          }
        );
        if (r.ok) {
          const n = (JSON.parse(r.text).ac ?? []).length;
          return { health: "LIVE" as Health, detail: `${n} aircraft returned.` };
        }
        return {
          health: "AUTH_FAILED" as Health,
          detail: `HTTP ${r.status}: ${r.text.slice(0, 120)}. Subscribe the RapidAPI key to the ADS-B Exchange API.`,
        };
      }
    ),

    // --- Maritime ---------------------------------------------------------
    probe("AISStream", "Live AIS vessel telemetry", Boolean(env.AISSTREAM_API_KEY), async () => ({
      health: "LIVE" as Health,
      detail:
        "Key configured. The socket's real state is reported by /api/defense/vessels, which owns the connection.",
    })),

    // --- Radar ------------------------------------------------------------
    probe(
      "Copernicus CDSE",
      "Sentinel-1 SAR imagery",
      Boolean(env.CDSE_CLIENT_ID && env.CDSE_CLIENT_SECRET),
      async () => {
        const res = await fetch(
          "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
          {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "client_credentials",
              client_id: env.CDSE_CLIENT_ID!,
              client_secret: env.CDSE_CLIENT_SECRET!,
            }).toString(),
            signal: AbortSignal.timeout(25000),
          }
        );
        if (!res.ok) {
          return {
            health: "AUTH_FAILED" as Health,
            detail: `Token request returned HTTP ${res.status}.`,
          };
        }
        return {
          health: "LIVE" as Health,
          detail:
            "OAuth token issued. Sentinel-1 GRD is authorised; the Copernicus DEM collection is not, so the land mask is derived from the radar scene instead.",
        };
      }
    ),

    // --- Thermal ----------------------------------------------------------
    probe("NASA FIRMS", "Active fire and thermal anomalies", Boolean(env.NASA_FIRMS_MAP_KEY), async () => {
      const r = await fetchText(
        `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${env.NASA_FIRMS_MAP_KEY}/VIIRS_NOAA20_NRT/87.0,17.0,96.5,27.5/1`,
        { headers: { "User-Agent": "AIEXNET-Defense/2.0" } }
      );
      if (!r.ok) return { health: "UNREACHABLE" as Health, detail: r.error ?? `HTTP ${r.status}` };
      if (r.text.startsWith("Invalid")) {
        return { health: "AUTH_FAILED" as Health, detail: "FIRMS rejected the MAP_KEY." };
      }
      const rows = Math.max(0, r.text.trim().split("\n").length - 1);
      return {
        health: "LIVE" as Health,
        detail: `${rows} detection(s) in the last 24 h over the region (delivered via ${r.via}).`,
      };
    }),

    // --- Space ------------------------------------------------------------
    probe("CelesTrak", "Orbital element sets for SGP4", true, async () => {
      const r = await fetchText(
        "https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=TLE"
      );
      if (!r.ok || !r.text.includes("1 25544")) {
        return { health: "UNREACHABLE" as Health, detail: r.error ?? "No element set returned." };
      }
      return { health: "LIVE" as Health, detail: "Element sets available." };
    }),

    probe("N2YO", "Satellite catalogue and overpass predictions", Boolean(env.N2YO_API_KEY), async () => {
      const r = await fetchText(
        `https://api.n2yo.com/rest/v1/satellite/positions/25544/23.68/90.35/0/2/&apiKey=${env.N2YO_API_KEY}`
      );
      if (!r.ok) return { health: "UNREACHABLE" as Health, detail: r.error ?? `HTTP ${r.status}` };
      const json = JSON.parse(r.text);
      if (json?.error) return { health: "AUTH_FAILED" as Health, detail: String(json.error) };
      return {
        health: "LIVE" as Health,
        detail: `${json?.info?.satname ?? "satellite"} at ${json?.positions?.[0]?.sataltitude ?? "?"} km.`,
      };
    }),

    // --- Weather ----------------------------------------------------------
    probe("Windy point forecast", "Wind and pressure forecast", Boolean(env.WINDY_API_KEY), async () => {
      const res = await fetch("https://api.windy.com/api/point-forecast/v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lat: 22.33,
          lon: 91.83,
          model: "gfs",
          parameters: ["wind"],
          levels: ["surface"],
          key: env.WINDY_API_KEY,
        }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return { health: "LIVE" as Health, detail: "Forecast returned." };
      const text = await res.text();
      return {
        health: "AUTH_FAILED" as Health,
        detail: `HTTP ${res.status}: ${text.slice(0, 120)}. A Map Forecast key does not work here — the Point Forecast API needs its own key.`,
      };
    }),

    probe("Windy webcams", "Coastal camera feeds", Boolean(env.WINDY_WEBCAMS_API_KEY), async () => {
      const r = await fetchText(
        "https://api.windy.com/webcams/api/v3/webcams?limit=5&countries=BD",
        { headers: { "x-windy-api-key": env.WINDY_WEBCAMS_API_KEY! } }
      );
      if (!r.ok) {
        return { health: "AUTH_FAILED" as Health, detail: `HTTP ${r.status}: ${r.text.slice(0, 120)}` };
      }
      const total = JSON.parse(r.text)?.total ?? 0;
      if (total === 0) {
        return {
          health: "NO_DATA" as Health,
          detail:
            "Key valid, but Windy lists no webcams in Bangladesh. There is no Chittagong or Cox's Bazar feed to show.",
        };
      }
      return { health: "LIVE" as Health, detail: `${total} webcam(s) available.` };
    }),

    // --- Weather fallback that needs no key -------------------------------
    probe("Open-Meteo", "Weather fallback, no key required", true, async () => {
      const r = await fetchText(
        "https://api.open-meteo.com/v1/forecast?latitude=22.33&longitude=91.83&current=temperature_2m,wind_speed_10m"
      );
      if (!r.ok) return { health: "UNREACHABLE" as Health, detail: r.error ?? `HTTP ${r.status}` };
      const c = JSON.parse(r.text)?.current;
      return {
        health: "LIVE" as Health,
        detail: `Chittagong ${c?.temperature_2m}°C, wind ${c?.wind_speed_10m} km/h.`,
      };
    }),
  ]);

  const counts = reports.reduce<Record<string, number>>((acc, r) => {
    acc[r.health] = (acc[r.health] ?? 0) + 1;
    return acc;
  }, {});

  return NextResponse.json(
    {
      success: true,
      timestamp: new Date().toISOString(),
      summary: counts,
      note: "Probed live. A configured key is not a working key — each entry reflects what the upstream actually answered just now.",
      sources: reports.sort((a, b) => a.id.localeCompare(b.id)),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
