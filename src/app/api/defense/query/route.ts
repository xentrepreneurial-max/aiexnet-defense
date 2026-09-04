import { NextRequest, NextResponse } from "next/server";
import { ensurePollerRunning, getTracks, getFeedDiagnostics } from "@/lib/adsbStore";
import { ensureAisRunning, getVessels, getAisStatus } from "@/lib/aisStore";
import { getFirmsData } from "@/lib/firms";
import { haversineKm, isInAdiz, isInEez, isOverBangladesh } from "@/lib/airspace";
import { describeSector } from "@/lib/regions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Tactical query endpoint.
 *
 * This answers questions by COMPUTING over the live feeds. It is not a
 * language model and it does not speculate: every number it returns is
 * measured from a current observation, and if a feed is down it says so
 * instead of answering anyway.
 */

interface Answer {
  headline: string;
  lines: string[];
  /** Feeds this answer was computed from, and their state at query time. */
  provenance: string[];
  coordinates?: [number, number];
}

const DHAKA = { lat: 23.8103, lon: 90.4125 };

function fmtKts(v: number) {
  return `${Math.round(v)} kt`;
}

async function buildAnswer(query: string): Promise<Answer> {
  const q = query.toLowerCase();
  const tracks = getTracks();
  const vessels = getVessels();
  const airDiag = getFeedDiagnostics();
  const aisStatus = getAisStatus();

  const provenance = [
    `ADS-B: ${airDiag.linkState} (${tracks.length} contacts, cycle ${airDiag.cycleLengthSec}s)`,
    `AIS: ${aisStatus.linkState} (${vessels.length} vessels)`,
  ];

  const wants = (...keys: string[]) => keys.some((k) => q.includes(k));

  // --- Feed health -------------------------------------------------------
  if (wants("status", "link", "feed", "health", "স্ট্যাটাস", "লিংক")) {
    return {
      headline: "SENSOR LINK STATUS",
      lines: [
        `ADS-B air picture: ${airDiag.linkState}, ${tracks.length} live contacts.`,
        `Cycle completes every ${airDiag.cycleLengthSec}s: ${airDiag.coverage.corePoints.length} core points every cycle, ${airDiag.coverage.extendedPerCycle} of ${airDiag.coverage.extendedPoints} extended points per cycle.`,
        ...airDiag.sources.map(
          (s) =>
            `  ${s.name}: ${
              s.lastOkAgeSec === null ? "never responded" : `last OK ${s.lastOkAgeSec}s ago`
            }${s.lastError ? ` — ${s.lastError}` : ""}`
        ),
        `Global military sweep: ${
          airDiag.lastMilSweepAgeSec === null
            ? "not yet run"
            : `${airDiag.lastMilSweepAgeSec}s ago, ${airDiag.militaryTracksLastSweep} in theatre`
        }`,
        `AIS maritime: ${aisStatus.linkState}. ${aisStatus.message ?? "Receiving."}`,
        "",
        airDiag.coverage.note,
      ],
      provenance,
    };
  }

  // --- Military / unidentified contacts ----------------------------------
  if (wants("military", "মিলিটারি", "যুদ্ধবিমান", "fighter", "unident", "unknown", "অজ্ঞাত")) {
    const mil = tracks.filter((t) => t.category === "MILITARY");
    const noId = tracks.filter(
      (t) => !t.on_ground && (!t.callsign || t.callsign === "NO CALLSIGN")
    );

    if (airDiag.linkState === "OFFLINE") {
      return {
        headline: "CANNOT ANSWER — AIR FEED DOWN",
        lines: ["No ADS-B upstream is reachable, so there is no air picture to query."],
        provenance,
      };
    }

    return {
      headline: `${mil.length} MILITARY-CLASSIFIED, ${noId.length} WITHOUT CALLSIGN`,
      lines: [
        ...(mil.length === 0
          ? ["No aircraft in coverage matched a military registry, type code, or hex block."]
          : mil.slice(0, 8).map(
              (t) =>
                `${t.callsign} · ${t.aircraftType ?? "type unknown"} · ${
                  t.origin_country
                } · ${t.altitudeFt ?? 0} ft · ${fmtKts(t.groundSpeedKts ?? 0)} · ${describeSector(
                  t.latitude,
                  t.longitude
                )} — basis: ${t.classificationBasis?.[0] ?? "n/a"}`
            )),
        ...(noId.length > 0
          ? [
              "",
              "Transmitting position but no callsign:",
              ...noId
                .slice(0, 6)
                .map(
                  (t) =>
                    `  ICAO ${t.icao24.toUpperCase()} · ${t.origin_country} · ${
                      t.altitudeFt ?? 0
                    } ft · ${fmtKts(t.groundSpeedKts ?? 0)}`
                ),
            ]
          : []),
      ],
      provenance,
      coordinates: mil[0] ? [mil[0].longitude, mil[0].latitude] : undefined,
    };
  }

  // --- Airspace incursion ------------------------------------------------
  if (wants("adiz", "border", "সীমান্ত", "incursion", "airspace", "এয়ারস্পেস", "sovereign")) {
    const inAdiz = tracks.filter((t) => isInAdiz(t.longitude, t.latitude));
    const overLand = inAdiz.filter((t) => isOverBangladesh(t.longitude, t.latitude));
    const foreignMil = inAdiz.filter(
      (t) => t.category === "MILITARY" && t.origin_country !== "Bangladesh"
    );

    return {
      headline: `${inAdiz.length} CONTACTS INSIDE ADIZ ENVELOPE (approx.)`,
      lines: [
        `${overLand.length} of them are over Bangladesh land territory (approx. boundary).`,
        `${foreignMil.length} are military-classified and not Bangladesh-registered.`,
        "",
        ...(foreignMil.length > 0
          ? foreignMil
              .slice(0, 6)
              .map(
                (t) =>
                  `${t.callsign} · ${t.origin_country} · ${t.aircraftType ?? "?"} · ${
                    t.altitudeFt ?? 0
                  } ft · hdg ${Math.round(t.true_track)}° · ${describeSector(
                    t.latitude,
                    t.longitude
                  )}`
              )
          : ["No foreign military-classified aircraft inside the envelope right now."]),
        "",
        "NOTE: ADIZ and border polygons here are hand-digitised approximations for display, not surveyed boundaries.",
      ],
      provenance,
    };
  }

  // --- Maritime ----------------------------------------------------------
  if (wants("vessel", "ship", "sea", "maritime", "নৌ", "জাহাজ", "সাগর", "bengal")) {
    if (aisStatus.linkState === "NO_KEY") {
      return {
        headline: "MARITIME PICTURE NOT AVAILABLE",
        lines: [
          "The AIS feed is not configured, so there is no vessel data to query.",
          "Set AISSTREAM_API_KEY (free at aisstream.io) and the Bay of Bengal picture becomes live.",
        ],
        provenance,
      };
    }
    const inEez = vessels.filter((v) => isInEez(v.longitude, v.latitude));
    const naval = vessels.filter((v) => v.type === "NAVAL" || v.type === "COAST_GUARD");
    return {
      headline: `${vessels.length} VESSELS TRACKED · ${inEez.length} INSIDE EEZ (approx.)`,
      lines: [
        `Naval / law-enforcement contacts: ${naval.length}`,
        "",
        ...naval
          .slice(0, 8)
          .map(
            (v) =>
              `${v.name} · MMSI ${v.mmsi} · ${v.flag} · ${v.speed} kt · course ${Math.round(
                v.heading
              )}° · ${describeSector(v.latitude, v.longitude)}`
          ),
      ],
      provenance,
    };
  }

  // --- Thermal -----------------------------------------------------------
  if (wants("fire", "thermal", "hotspot", "আগুন", "firms", "burn")) {
    const firms = await getFirmsData();
    provenance.push(`FIRMS: ${firms.status.linkState} (${firms.data.length} detections)`);
    if (firms.status.linkState !== "LIVE") {
      return {
        headline: "THERMAL PICTURE NOT AVAILABLE",
        lines: [firms.status.message ?? "FIRMS feed unavailable."],
        provenance,
      };
    }
    const strong = [...firms.data].sort((a, b) => (b.frp ?? 0) - (a.frp ?? 0)).slice(0, 8);
    return {
      headline: `${firms.data.length} ACTIVE THERMAL DETECTIONS (LAST 24 H)`,
      lines: strong.map(
        (t) =>
          `${Math.round(t.frp ?? 0)} MW · ${t.brightness} K · ${t.confidence}% · ${
            t.satellite
          } · ${t.areaDescription} · ${t.detectionTime.slice(11, 16)}Z`
      ),
      provenance,
      coordinates: strong[0] ? [strong[0].longitude, strong[0].latitude] : undefined,
    };
  }

  // --- Fastest / highest -------------------------------------------------
  if (wants("fastest", "highest", "দ্রুত", "উঁচু", "speed", "altitude")) {
    const airborne = tracks.filter((t) => !t.on_ground);
    const fastest = [...airborne].sort(
      (a, b) => (b.groundSpeedKts ?? 0) - (a.groundSpeedKts ?? 0)
    )[0];
    const highest = [...airborne].sort((a, b) => (b.altitudeFt ?? 0) - (a.altitudeFt ?? 0))[0];
    return {
      headline: "KINEMATIC EXTREMES IN CURRENT PICTURE",
      lines: [
        fastest
          ? `Fastest: ${fastest.callsign} (${fastest.aircraftType ?? "?"}) at ${fmtKts(
              fastest.groundSpeedKts ?? 0
            )}, ${fastest.altitudeFt ?? 0} ft, ${describeSector(fastest.latitude, fastest.longitude)}`
          : "No airborne contacts.",
        highest
          ? `Highest: ${highest.callsign} (${highest.aircraftType ?? "?"}) at ${
              highest.altitudeFt ?? 0
            } ft, ${fmtKts(highest.groundSpeedKts ?? 0)}`
          : "",
      ].filter(Boolean),
      provenance,
      coordinates: fastest ? [fastest.longitude, fastest.latitude] : undefined,
    };
  }

  // --- Default: overall air picture --------------------------------------
  const byCategory = tracks.reduce<Record<string, number>>((acc, t) => {
    acc[t.category] = (acc[t.category] ?? 0) + 1;
    return acc;
  }, {});
  const nearDhaka = tracks
    .map((t) => ({ t, d: haversineKm(t.latitude, t.longitude, DHAKA.lat, DHAKA.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 5);

  return {
    headline:
      airDiag.linkState === "OFFLINE"
        ? "NO AIR PICTURE — ALL ADS-B UPSTREAMS UNREACHABLE"
        : `${tracks.length} LIVE AIR CONTACTS IN COVERAGE`,
    lines:
      airDiag.linkState === "OFFLINE"
        ? ["Nothing can be reported until an upstream responds."]
        : [
            Object.entries(byCategory)
              .map(([k, v]) => `${k}: ${v}`)
              .join("  ·  "),
            "",
            "Nearest to Dhaka:",
            ...nearDhaka.map(
              ({ t, d }) =>
                `  ${t.callsign} · ${t.aircraftType ?? "?"} · ${Math.round(d)} km · ${
                  t.altitudeFt ?? 0
                } ft · ${fmtKts(t.groundSpeedKts ?? 0)}`
            ),
          ],
    provenance,
  };
}

export async function POST(req: NextRequest) {
  ensurePollerRunning();
  ensureAisRunning();

  let query = "";
  try {
    const body = await req.json();
    query = String(body?.query ?? "");
  } catch {
    return NextResponse.json({ success: false, error: "Body must be JSON with a query field." }, { status: 400 });
  }

  const answer = await buildAnswer(query);
  return NextResponse.json(
    { success: true, query, answer, timestamp: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } }
  );
}
