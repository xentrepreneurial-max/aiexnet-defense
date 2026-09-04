/**
 * Live AIS vessel track store (AISStream.io).
 *
 * AIS is a broadcast protocol: ships transmit their own position, and shore
 * stations / satellites relay it. AISStream.io provides a free WebSocket feed
 * of that relay. It requires an API key, which is free to create.
 *
 * Without AISSTREAM_API_KEY set, this store reports NO_KEY and returns zero
 * vessels. It never fabricates ships — an empty sea here means "no feed",
 * and the HUD says exactly that.
 */

import { VesselData } from "@/types/intelligence";
import { flagFromMmsi } from "./mid";

/** Bay of Bengal + Bangladesh coast + Andaman approaches. */
const BOUNDING_BOXES: number[][][] = [
  [
    [26.0, 79.0], // NW corner [lat, lon]
    [3.0, 99.0], // SE corner
  ],
];

const VESSEL_TTL_MS = 45 * 60 * 1000; // AIS reports can be sparse offshore
const HISTORY_POINTS = 40;
const RECONNECT_BASE_MS = 5_000;
const RECONNECT_MAX_MS = 120_000;

interface StaticInfo {
  name?: string;
  shipType?: number;
  destination?: string;
  imo?: string;
  callsign?: string;
  lengthM?: number;
  beamM?: number;
  draughtM?: number;
  eta?: string;
}

interface StoredVessel extends VesselData {
  history: Array<[number, number]>;
}

interface AisStore {
  vessels: Map<string, StoredVessel>;
  statics: Map<string, StaticInfo>;
  ws: WebSocket | null;
  connected: boolean;
  connecting: boolean;
  lastMessageAt: number;
  lastError: string | null;
  reconnectAttempts: number;
  messagesReceived: number;
  startedAt: number;
}

const globalRef = globalThis as unknown as { __aiexnetAisStore?: AisStore };

function store(): AisStore {
  if (!globalRef.__aiexnetAisStore) {
    globalRef.__aiexnetAisStore = {
      vessels: new Map(),
      statics: new Map(),
      ws: null,
      connected: false,
      connecting: false,
      lastMessageAt: 0,
      lastError: null,
      reconnectAttempts: 0,
      messagesReceived: 0,
      startedAt: Date.now(),
    };
  }
  return globalRef.__aiexnetAisStore;
}

/** ITU-R M.1371 ship-and-cargo type code → our display category. */
function mapShipType(code?: number): VesselData["type"] {
  if (code == null) return "OTHER";
  if (code === 35) return "NAVAL"; // Military operations
  if (code === 55) return "COAST_GUARD"; // Law enforcement
  if (code === 51) return "COAST_GUARD"; // Search and rescue
  if (code === 30) return "FISHING";
  if (code === 52 || code === 31 || code === 32) return "TUG";
  if (code >= 60 && code <= 69) return "PASSENGER";
  if (code >= 70 && code <= 79) return "CARGO";
  if (code >= 80 && code <= 89) return "TANKER";
  return "OTHER";
}

/** ITU-R M.1371 navigational status code → display status. */
function mapNavStatus(code?: number, shipType?: number): VesselData["status"] {
  if (shipType === 35 || shipType === 55) return "PATROL";
  switch (code) {
    case 0:
    case 8:
      return "UNDERWAY";
    case 1:
      return "ANCHORED";
    case 5:
      return "MOORED";
    case 6:
      return "AGROUND";
    case 7:
      return "FISHING";
    default:
      return "UNKNOWN";
  }
}

function assessThreat(v: {
  type: VesselData["type"];
  speed: number;
  navStatus?: number;
  positionAgeMin: number;
}): VesselData["threatLevel"] {
  // "Suspicious" here means operationally notable, derived from the AIS
  // report itself — not a guess about intent.
  if (v.type === "NAVAL") return "SUSPICIOUS";
  if (v.navStatus === 2) return "SUSPICIOUS"; // not under command
  if (v.navStatus === 3) return "SUSPICIOUS"; // restricted manoeuvrability
  return "NORMAL";
}

function handleMessage(raw: string) {
  const s = store();
  let msg: any;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  s.messagesReceived++;
  s.lastMessageAt = Date.now();

  const meta = msg.MetaData || {};
  const mmsi = String(meta.MMSI ?? meta.mmsi ?? "").trim();
  if (!mmsi) return;

  if (msg.MessageType === "ShipStaticData") {
    const d = msg.Message?.ShipStaticData || {};
    const prev = s.statics.get(mmsi) || {};
    const dim = d.Dimension || {};
    s.statics.set(mmsi, {
      ...prev,
      name: (d.Name || meta.ShipName || prev.name || "").trim() || undefined,
      shipType: typeof d.Type === "number" ? d.Type : prev.shipType,
      destination: (d.Destination || prev.destination || "").trim() || undefined,
      imo: d.ImoNumber ? String(d.ImoNumber) : prev.imo,
      callsign: (d.CallSign || prev.callsign || "").trim() || undefined,
      lengthM:
        dim.A != null && dim.B != null ? Number(dim.A) + Number(dim.B) : prev.lengthM,
      beamM: dim.C != null && dim.D != null ? Number(dim.C) + Number(dim.D) : prev.beamM,
      draughtM:
        typeof d.MaximumStaticDraught === "number"
          ? d.MaximumStaticDraught
          : prev.draughtM,
      eta:
        d.Eta && d.Eta.Month
          ? `${String(d.Eta.Day).padStart(2, "0")}/${String(d.Eta.Month).padStart(2, "0")} ${String(d.Eta.Hour).padStart(2, "0")}:${String(d.Eta.Minute).padStart(2, "0")} UTC`
          : prev.eta,
    });
    return;
  }

  if (msg.MessageType !== "PositionReport") return;

  const pr = msg.Message?.PositionReport || {};
  const lat = Number(pr.Latitude ?? meta.latitude);
  const lon = Number(pr.Longitude ?? meta.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return;

  const st = s.statics.get(mmsi) || {};
  const sog = Number(pr.Sog ?? 0);
  const cog = Number(pr.Cog ?? 0);
  const trueHeading = pr.TrueHeading != null && pr.TrueHeading < 360 ? Number(pr.TrueHeading) : null;
  const navStatus = typeof pr.NavigationalStatus === "number" ? pr.NavigationalStatus : undefined;

  const reportTime = meta.time_utc ? Date.parse(meta.time_utc) : Date.now();
  const type = mapShipType(st.shipType);

  const existing = s.vessels.get(mmsi);
  const history = existing ? existing.history.slice() : [];
  const last = history[history.length - 1];
  if (!last || last[0] !== lon || last[1] !== lat) {
    history.push([Number(lon.toFixed(5)), Number(lat.toFixed(5))]);
    if (history.length > HISTORY_POINTS) history.shift();
  }

  s.vessels.set(mmsi, {
    mmsi,
    name: (st.name || meta.ShipName || "").trim() || `MMSI ${mmsi}`,
    type,
    flag: flagFromMmsi(mmsi),
    latitude: Number(lat.toFixed(5)),
    longitude: Number(lon.toFixed(5)),
    speed: Number(sog.toFixed(1)),
    heading: Number(cog.toFixed(1)),
    trueHeading,
    destination: st.destination || "NOT REPORTED",
    status: mapNavStatus(navStatus, st.shipType),
    threatLevel: assessThreat({
      type,
      speed: sog,
      navStatus,
      positionAgeMin: 0,
    }),
    imo: st.imo ?? null,
    callsign: st.callsign ?? null,
    lengthM: st.lengthM ?? null,
    beamM: st.beamM ?? null,
    draughtM: st.draughtM ?? null,
    eta: st.eta ?? null,
    lastReport: Number.isFinite(reportTime) ? reportTime : Date.now(),
    dataSource: "AIS",
    history,
  });
}

function evictStale() {
  const s = store();
  const now = Date.now();
  for (const [mmsi, v] of s.vessels) {
    if (now - (v.lastReport ?? 0) > VESSEL_TTL_MS) s.vessels.delete(mmsi);
  }
}

function connect() {
  const s = store();
  const apiKey = process.env.AISSTREAM_API_KEY;
  if (!apiKey) return;
  if (s.connecting || s.connected) return;
  if (typeof WebSocket === "undefined") {
    s.lastError = "Runtime has no WebSocket support (Node 22+ required)";
    return;
  }

  s.connecting = true;
  try {
    const ws = new WebSocket("wss://stream.aisstream.io/v0/stream");
    s.ws = ws;

    ws.onopen = () => {
      s.connected = true;
      s.connecting = false;
      s.reconnectAttempts = 0;
      s.lastError = null;
      ws.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: BOUNDING_BOXES,
          FilterMessageTypes: ["PositionReport", "ShipStaticData"],
        })
      );
    };

    ws.onmessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (typeof data === "string") handleMessage(data);
      else if (data instanceof Blob) void data.text().then(handleMessage);
      else if (data instanceof ArrayBuffer) handleMessage(new TextDecoder().decode(data));
    };

    ws.onerror = () => {
      s.lastError = "AISStream socket error";
    };

    ws.onclose = (ev: CloseEvent) => {
      s.connected = false;
      s.connecting = false;
      s.ws = null;
      if (ev.code === 1008 || ev.reason?.toLowerCase().includes("api key")) {
        s.lastError = `AISStream rejected the API key (${ev.reason || "code 1008"})`;
        return; // do not hammer the endpoint with a bad key
      }
      s.lastError = s.lastError || `Socket closed (${ev.code})`;
      s.reconnectAttempts++;
      const delay = Math.min(
        RECONNECT_BASE_MS * 2 ** Math.min(s.reconnectAttempts, 5),
        RECONNECT_MAX_MS
      );
      const t = setTimeout(connect, delay);
      if (typeof t.unref === "function") t.unref();
    };
  } catch (err: any) {
    s.connecting = false;
    s.lastError = String(err?.message || err);
  }
}

export function ensureAisRunning() {
  connect();
  const s = store();
  if (!(globalRef as any).__aiexnetAisEvict) {
    const t = setInterval(evictStale, 60_000);
    if (typeof t.unref === "function") t.unref();
    (globalRef as any).__aiexnetAisEvict = t;
  }
  return s;
}

export function getVessels(): StoredVessel[] {
  return Array.from(store().vessels.values());
}

export function getAisStatus() {
  const s = store();
  const now = Date.now();
  const hasKey = Boolean(process.env.AISSTREAM_API_KEY);

  let linkState: "LIVE" | "DEGRADED" | "OFFLINE" | "NO_KEY";
  let message: string | null = null;

  if (!hasKey) {
    linkState = "NO_KEY";
    message =
      "AIS feed not configured. Set AISSTREAM_API_KEY (free at aisstream.io) to receive live vessel traffic.";
  } else if (s.connected && now - s.lastMessageAt < 60_000) {
    linkState = "LIVE";
  } else if (s.vessels.size > 0) {
    linkState = "DEGRADED";
    message = s.lastError || "AIS socket quiet — positions are ageing.";
  } else {
    linkState = "OFFLINE";
    message = s.lastError || "AIS socket not connected.";
  }

  return {
    id: "SEA",
    linkState,
    source: hasKey ? "AISStream.io (AIS terrestrial + satellite relay)" : "NOT CONFIGURED",
    count: s.vessels.size,
    lastUpdateAgeSec:
      s.lastMessageAt > 0 ? Math.round((now - s.lastMessageAt) / 1000) : null,
    message,
    diagnostics: {
      connected: s.connected,
      messagesReceived: s.messagesReceived,
      staticRecords: s.statics.size,
      reconnectAttempts: s.reconnectAttempts,
      lastError: s.lastError,
      boundingBox: BOUNDING_BOXES[0],
    },
  };
}
