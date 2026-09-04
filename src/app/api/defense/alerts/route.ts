import { NextResponse } from "next/server";
import { ThreatAlert } from "@/types/intelligence";
import { ensurePollerRunning, getTracks } from "@/lib/adsbStore";
import { ensureAisRunning, getVessels } from "@/lib/aisStore";
import { getFirmsData } from "@/lib/firms";
import { isInAdiz, isInEez, isOverBangladesh, haversineKm } from "@/lib/airspace";
import { describeSector } from "@/lib/regions";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Threat stream.
 *
 * Every entry is generated from an observation that is present in one of the
 * live feeds right now, and carries the feed name and record id that produced
 * it. If nothing meets a trigger, the stream is empty — that is a valid and
 * honest result, not a failure.
 */

function relativeTime(epoch: number): string {
  const secs = Math.max(0, Math.round((Date.now() - epoch) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

export async function GET() {
  ensurePollerRunning();
  ensureAisRunning();

  const alerts: ThreatAlert[] = [];
  const tracks = getTracks();
  const vessels = getVessels();

  // 1. Transponder emergency states — the highest-confidence signal available.
  for (const t of tracks) {
    if (!t.emergency) continue;
    const observedAt = t.positionTime ?? t.lastContact;
    alerts.push({
      id: `air-emg-${t.icao24}`,
      timestamp: relativeTime(observedAt),
      epoch: observedAt,
      level: "DEFCON_2",
      severity: "CRITICAL",
      title: `EMERGENCY SQUAWK ${t.squawk ?? ""} — ${t.callsign}`,
      description: `${t.registration ? t.registration + " " : ""}${
        t.model ?? t.aircraftType ?? "unknown airframe"
      } squawking ${t.squawk ?? "emergency"} at ${t.altitudeFt ?? 0} ft, ${
        t.groundSpeedKts ?? 0
      } kts. ${t.classificationBasis?.join("; ") ?? ""}`,
      sector: describeSector(t.latitude, t.longitude),
      coordinates: [t.longitude, t.latitude],
      evidence: {
        feed: "ADS-B",
        recordId: t.icao24,
        observedAt: new Date(observedAt).toISOString(),
      },
    });
  }

  // 2. Military-classified aircraft inside the ADIZ envelope.
  for (const t of tracks) {
    if (t.category !== "MILITARY") continue;
    if (!isInAdiz(t.longitude, t.latitude)) continue;
    const observedAt = t.positionTime ?? t.lastContact;
    const overLand = isOverBangladesh(t.longitude, t.latitude);
    alerts.push({
      id: `air-mil-${t.icao24}`,
      timestamp: relativeTime(observedAt),
      epoch: observedAt,
      level: overLand ? "DEFCON_2" : "DEFCON_3",
      severity: overLand ? "CRITICAL" : "HIGH",
      title: `MILITARY CONTACT ${overLand ? "OVER SOVEREIGN TERRITORY" : "IN ADIZ (approx.)"} — ${t.callsign}`,
      description: `${t.model ?? t.aircraftType ?? "Military airframe"}${
        t.registration ? ` (${t.registration})` : ""
      }, ICAO ${t.icao24.toUpperCase()}, registered ${t.origin_country}. ${
        t.altitudeFt ?? 0
      } ft, ${t.groundSpeedKts ?? 0} kts, heading ${Math.round(t.true_track)}°. Basis: ${
        t.classificationBasis?.join("; ") ?? "n/a"
      }`,
      sector: describeSector(t.latitude, t.longitude),
      coordinates: [t.longitude, t.latitude],
      evidence: {
        feed: "ADS-B",
        recordId: t.icao24,
        observedAt: new Date(observedAt).toISOString(),
      },
    });
  }

  // 3. Non-cooperative profile: airborne, moving fast, transmitting no callsign.
  for (const t of tracks) {
    if (t.on_ground) continue;
    if (t.callsign && t.callsign !== "NO CALLSIGN") continue;
    if ((t.groundSpeedKts ?? 0) < 250) continue;
    if (!isInAdiz(t.longitude, t.latitude)) continue;
    const observedAt = t.positionTime ?? t.lastContact;
    alerts.push({
      id: `air-noid-${t.icao24}`,
      timestamp: relativeTime(observedAt),
      epoch: observedAt,
      level: "DEFCON_3",
      severity: "MEDIUM",
      title: `UNIDENTIFIED CONTACT — ICAO ${t.icao24.toUpperCase()}`,
      description: `Airborne contact transmitting position but no callsign. ${
        t.altitudeFt ?? 0
      } ft, ${t.groundSpeedKts ?? 0} kts, heading ${Math.round(
        t.true_track
      )}°. ICAO address allocated to ${t.origin_country}.`,
      sector: describeSector(t.latitude, t.longitude),
      coordinates: [t.longitude, t.latitude],
      evidence: {
        feed: "ADS-B",
        recordId: t.icao24,
        observedAt: new Date(observedAt).toISOString(),
      },
    });
  }

  // 4. Naval / law-enforcement vessels reporting inside the EEZ envelope.
  for (const v of vessels) {
    if (v.type !== "NAVAL" && v.type !== "COAST_GUARD") continue;
    if (!isInEez(v.longitude, v.latitude)) continue;
    const observedAt = v.lastReport ?? Date.now();
    alerts.push({
      id: `sea-mil-${v.mmsi}`,
      timestamp: relativeTime(observedAt),
      epoch: observedAt,
      level: "DEFCON_3",
      severity: "HIGH",
      title: `${v.type === "NAVAL" ? "NAVAL" : "LAW ENFORCEMENT"} VESSEL IN EEZ (approx.) — ${v.name}`,
      description: `MMSI ${v.mmsi}, flag ${v.flag}, ${v.speed} kts on course ${Math.round(
        v.heading
      )}°. Status: ${v.status}. Declared destination: ${v.destination}.`,
      sector: describeSector(v.latitude, v.longitude),
      coordinates: [v.longitude, v.latitude],
      evidence: {
        feed: "AIS",
        recordId: v.mmsi,
        observedAt: new Date(observedAt).toISOString(),
      },
    });
  }

  // 5. High-energy thermal detections close to the Bangladesh frontier.
  const firms = await getFirmsData();
  const BORDER_REF = { lat: 21.2, lon: 92.35 }; // Naf river frontier reference
  for (const th of firms.data) {
    if ((th.frp ?? 0) < 25) continue;
    const distKm = haversineKm(th.latitude, th.longitude, BORDER_REF.lat, BORDER_REF.lon);
    if (distKm > 150) continue;
    const observedAt = th.detectionEpoch ?? Date.now();
    alerts.push({
      id: `thm-${th.id}`,
      timestamp: relativeTime(observedAt),
      epoch: observedAt,
      level: "DEFCON_4",
      severity: (th.frp ?? 0) > 100 ? "HIGH" : "MEDIUM",
      title: `THERMAL ANOMALY ${Math.round(th.frp ?? 0)} MW — ${th.areaDescription}`,
      description: `${th.satellite} detected a ${th.brightness} K hotspot, ${
        th.confidence
      }% confidence, radiative power ${th.frp} MW, ${
        th.dayNight === "N" ? "night" : "day"
      } overpass. ${Math.round(distKm)} km from the Naf frontier reference point.`,
      sector: th.areaDescription,
      coordinates: [th.longitude, th.latitude],
      evidence: {
        feed: th.dataSource ?? "NASA FIRMS",
        recordId: th.id,
        observedAt: new Date(observedAt).toISOString(),
      },
    });
  }

  // Most recent, most severe first; cap the stream so the HUD stays readable.
  const severityRank: Record<ThreatAlert["severity"], number> = {
    CRITICAL: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  };
  alerts.sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || b.epoch - a.epoch
  );

  return NextResponse.json(
    {
      success: true,
      status: {
        id: "ALERTS",
        linkState: tracks.length > 0 || vessels.length > 0 ? "LIVE" : "OFFLINE",
        source: "Derived from ADS-B / AIS / FIRMS observations",
        count: alerts.length,
        lastUpdateAgeSec: 0,
        message:
          alerts.length === 0
            ? "No triggering observations in the current picture."
            : null,
      },
      timestamp: new Date().toISOString(),
      count: alerts.length,
      data: alerts.slice(0, 60),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
