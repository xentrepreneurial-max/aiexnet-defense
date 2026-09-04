/**
 * MAVLink vehicle link.
 *
 * Speaks real MAVLink v2 over UDP to a real autopilot — ArduPilot or PX4,
 * hardware or SITL. This is what makes "point at the map and the aircraft
 * flies there" true rather than a drawing: the waypoints planned in the UI are
 * uploaded to the vehicle with the standard mission protocol and flown by the
 * vehicle's own autopilot.
 *
 * Scope is navigation and flight safety: telemetry, mission upload, flight
 * mode, arm/disarm, reposition, return to launch. This is the same surface a
 * ground control station like QGroundControl exposes. No stores or payload
 * release handling exists here.
 *
 * Every command is recorded in an audit trail before it goes out, because on a
 * real vehicle "who commanded what, when" matters as much as the command.
 */

import dgram from "node:dgram";
import { MavlinkParser, encodeMessage, Payload } from "./codec";
import { MESSAGE_IDS } from "./messages";
import { ingestTelemetry } from "../droneStore";

/** MAV_CMD values used here. */
export const MAV_CMD = {
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_TAKEOFF: 22,
  DO_SET_MODE: 176,
  DO_REPOSITION: 192,
  COMPONENT_ARM_DISARM: 400,
  MISSION_START: 300,
} as const;

const MAV_MODE_FLAG_CUSTOM_MODE_ENABLED = 1;

/** ArduPilot custom mode numbers, which differ by airframe class. */
const COPTER_MODES: Record<string, number> = {
  STABILIZE: 0, ALT_HOLD: 2, AUTO: 3, GUIDED: 4, LOITER: 5,
  RTL: 6, CIRCLE: 7, LAND: 9, BRAKE: 17, SMART_RTL: 21,
};
const PLANE_MODES: Record<string, number> = {
  MANUAL: 0, CIRCLE: 1, STABILIZE: 2, FBWA: 5, FBWB: 6,
  TAKEOFF: 13, AUTO: 10, RTL: 11, LOITER: 12, GUIDED: 15, QRTL: 21,
};

/** MAV_TYPE values that mean fixed wing. */
const FIXED_WING_TYPES = new Set([1, 21, 22, 23, 24, 25, 26, 27, 28]);

export interface LinkConfig {
  /** Local UDP port to bind. ArduPilot's default GCS port is 14550. */
  listenPort: number;
  /** Optional explicit vehicle address; otherwise learned from first packet. */
  vehicleHost?: string;
  vehiclePort?: number;
  /** Our identity on the link. 255 is the conventional GCS system id. */
  systemId: number;
  componentId: number;
  /** Name shown for the vehicle in the UI. */
  vehicleName: string;
}

export interface AuditEntry {
  at: number;
  action: string;
  detail: string;
  result: "SENT" | "ACK" | "NACK" | "TIMEOUT" | "ERROR";
  message: string | null;
}

interface VehicleState {
  systemId: number | null;
  componentId: number;
  mavType: number | null;
  autopilot: number | null;
  baseMode: number;
  customMode: number;
  armed: boolean;
  lastHeartbeat: number;
  homeLat: number | null;
  homeLon: number | null;
  currentWaypoint: number | null;
  statusTexts: Array<{ at: number; severity: number; text: string }>;
}

interface PendingMission {
  items: Payload[];
  acked: boolean;
  resolve: ((result: { ok: boolean; message: string }) => void) | null;
  timer: NodeJS.Timeout | null;
  highestRequested: number;
}

interface LinkState {
  socket: dgram.Socket | null;
  parser: MavlinkParser;
  config: LinkConfig;
  remote: { address: string; port: number } | null;
  sequence: number;
  connectedAt: number;
  messagesReceived: number;
  messagesSent: number;
  lastError: string | null;
  vehicle: VehicleState;
  audit: AuditEntry[];
  pendingMission: PendingMission | null;
  heartbeatTimer: NodeJS.Timeout | null;
  /** Vitals arrive in different messages than position; carried alongside. */
  vitals: {
    batteryPercent: number | null;
    batteryVoltage: number | null;
    gpsFixType: number | null;
    satellitesVisible: number | null;
  };
}

const globalRef = globalThis as unknown as { __aiexnetMavLink?: LinkState };

function emptyVehicle(): VehicleState {
  return {
    systemId: null,
    componentId: 1,
    mavType: null,
    autopilot: null,
    baseMode: 0,
    customMode: 0,
    armed: false,
    lastHeartbeat: 0,
    homeLat: null,
    homeLon: null,
    currentWaypoint: null,
    statusTexts: [],
  };
}

export function getLink(): LinkState | null {
  return globalRef.__aiexnetMavLink ?? null;
}

function audit(state: LinkState, entry: Omit<AuditEntry, "at">) {
  state.audit.unshift({ at: Date.now(), ...entry });
  if (state.audit.length > 200) state.audit.pop();
}

function isFixedWing(state: LinkState): boolean {
  return state.vehicle.mavType != null && FIXED_WING_TYPES.has(state.vehicle.mavType);
}

export function modeTable(state: LinkState): Record<string, number> {
  return isFixedWing(state) ? PLANE_MODES : COPTER_MODES;
}

export function modeName(state: LinkState): string | null {
  const table = modeTable(state);
  for (const [name, value] of Object.entries(table)) {
    if (value === state.vehicle.customMode) return name;
  }
  return `MODE_${state.vehicle.customMode}`;
}

function send(state: LinkState, msgName: string, payload: Payload): boolean {
  if (!state.socket || !state.remote) {
    state.lastError = "No vehicle address yet — waiting for the first packet.";
    return false;
  }
  const frame = encodeMessage(MESSAGE_IDS[msgName], payload, {
    systemId: state.config.systemId,
    componentId: state.config.componentId,
    sequence: state.sequence++ & 0xff,
  });
  state.socket.send(Buffer.from(frame), state.remote.port, state.remote.address);
  state.messagesSent++;
  return true;
}

function targetIds(state: LinkState) {
  return {
    target_system: state.vehicle.systemId ?? 1,
    target_component: state.vehicle.componentId ?? 1,
  };
}

// ---------------------------------------------------------------------------
// Inbound message handling
// ---------------------------------------------------------------------------

function handleMessage(
  state: LinkState,
  msg: { name: string; systemId: number; componentId: number; payload: Payload }
) {
  const v = state.vehicle;
  const p = msg.payload as Record<string, number | string>;

  switch (msg.name) {
    case "HEARTBEAT": {
      // Ignore other ground stations chattering on the same port.
      if (Number(p.type) === 6) return;
      v.systemId = msg.systemId;
      v.componentId = msg.componentId;
      v.mavType = Number(p.type);
      v.autopilot = Number(p.autopilot);
      v.baseMode = Number(p.base_mode);
      v.customMode = Number(p.custom_mode);
      v.armed = (Number(p.base_mode) & 128) !== 0;
      v.lastHeartbeat = Date.now();
      break;
    }

    case "GLOBAL_POSITION_INT": {
      ingestTelemetry({
        vehicleId: String(v.systemId ?? msg.systemId),
        name: state.config.vehicleName,
        latitude: Number(p.lat) / 1e7,
        longitude: Number(p.lon) / 1e7,
        altitudeRelM: Number(p.relative_alt) / 1000,
        altitudeAmslM: Number(p.alt) / 1000,
        groundSpeedMs: Math.hypot(Number(p.vx), Number(p.vy)) / 100,
        headingDeg: Number(p.hdg) === 65535 ? 0 : Number(p.hdg) / 100,
        verticalSpeedMs: -Number(p.vz) / 100,
        flightMode: modeName(state),
        armed: v.armed,
        homeLatitude: v.homeLat,
        homeLongitude: v.homeLon,
        currentWaypoint: v.currentWaypoint,
        batteryPercent: state.vitals.batteryPercent,
        batteryVoltage: state.vitals.batteryVoltage,
        gpsFixType: state.vitals.gpsFixType,
        satellitesVisible: state.vitals.satellitesVisible,
      });
      break;
    }

    case "SYS_STATUS": {
      const remaining = Number(p.battery_remaining);
      state.vitals.batteryPercent = remaining >= 0 && remaining <= 100 ? remaining : null;
      const millivolts = Number(p.voltage_battery);
      state.vitals.batteryVoltage = millivolts === 65535 ? null : millivolts / 1000;
      break;
    }

    case "GPS_RAW_INT": {
      state.vitals.gpsFixType = Number(p.fix_type);
      const sats = Number(p.satellites_visible);
      state.vitals.satellitesVisible = sats === 255 ? null : sats;
      break;
    }

    case "HOME_POSITION": {
      v.homeLat = Number(p.latitude) / 1e7;
      v.homeLon = Number(p.longitude) / 1e7;
      break;
    }

    case "MISSION_CURRENT": {
      v.currentWaypoint = Number(p.seq);
      break;
    }

    case "STATUSTEXT": {
      v.statusTexts.unshift({
        at: Date.now(),
        severity: Number(p.severity),
        text: String(p.text),
      });
      if (v.statusTexts.length > 50) v.statusTexts.pop();
      break;
    }

    // The vehicle pulls mission items one at a time; serve what it asks for.
    case "MISSION_REQUEST_INT":
    case "MISSION_REQUEST": {
      const pending = state.pendingMission;
      if (!pending) return;
      const seq = Number(p.seq);
      if (seq >= pending.items.length) return;
      pending.highestRequested = Math.max(pending.highestRequested, seq);
      send(state, "MISSION_ITEM_INT", pending.items[seq]);
      break;
    }

    case "MISSION_ACK": {
      const pending = state.pendingMission;
      if (!pending) return;
      const type = Number(p.type);
      const ok = type === 0;
      pending.acked = true;
      if (pending.timer) clearTimeout(pending.timer);
      const message = ok
        ? `Vehicle accepted ${pending.items.length} mission items.`
        : `Vehicle rejected the mission (MAV_MISSION_RESULT ${type}).`;
      audit(state, {
        action: "MISSION_UPLOAD",
        detail: `${pending.items.length} items`,
        result: ok ? "ACK" : "NACK",
        message,
      });
      pending.resolve?.({ ok, message });
      state.pendingMission = null;
      break;
    }

    case "COMMAND_ACK": {
      const result = Number(p.result);
      audit(state, {
        action: `COMMAND_${p.command}`,
        detail: `result=${result}`,
        result: result === 0 ? "ACK" : "NACK",
        message:
          result === 0
            ? "Accepted"
            : `Refused by the autopilot (MAV_RESULT ${result}) in its current state.`,
      });
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

export async function connect(config: LinkConfig): Promise<{ ok: boolean; message: string }> {
  await disconnect();

  const state: LinkState = {
    socket: null,
    parser: new MavlinkParser(),
    config,
    remote:
      config.vehicleHost && config.vehiclePort
        ? { address: config.vehicleHost, port: config.vehiclePort }
        : null,
    sequence: 0,
    connectedAt: Date.now(),
    messagesReceived: 0,
    messagesSent: 0,
    lastError: null,
    vehicle: emptyVehicle(),
    audit: [],
    pendingMission: null,
    heartbeatTimer: null,
    vitals: {
      batteryPercent: null,
      batteryVoltage: null,
      gpsFixType: null,
      satellitesVisible: null,
    },
  };

  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    state.socket = socket;
    let settled = false;

    socket.on("error", (err) => {
      state.lastError = err.message;
      audit(state, { action: "LINK", detail: "socket error", result: "ERROR", message: err.message });
      if (!settled) {
        settled = true;
        resolve({ ok: false, message: `UDP ${config.listenPort}: ${err.message}` });
      }
    });

    socket.on("message", (data, rinfo) => {
      // ArduPilot and SITL transmit from an ephemeral port, so learn the
      // vehicle's address from its traffic rather than guessing it.
      if (!state.remote) state.remote = { address: rinfo.address, port: rinfo.port };
      state.messagesReceived++;
      for (const msg of state.parser.push(new Uint8Array(data))) {
        handleMessage(state, msg);
      }
    });

    socket.on("listening", () => {
      globalRef.__aiexnetMavLink = state;

      // A GCS heartbeat tells the autopilot a controller is present; some
      // failsafe configurations depend on seeing it.
      state.heartbeatTimer = setInterval(() => {
        send(state, "HEARTBEAT", {
          type: 6, // MAV_TYPE_GCS
          autopilot: 8, // MAV_AUTOPILOT_INVALID
          base_mode: 0,
          custom_mode: 0,
          system_status: 4, // MAV_STATE_ACTIVE
          mavlink_version: 3,
        });
      }, 1000);
      if (typeof state.heartbeatTimer.unref === "function") state.heartbeatTimer.unref();

      audit(state, {
        action: "LINK",
        detail: `listening on udp/${config.listenPort}`,
        result: "SENT",
        message: null,
      });

      if (!settled) {
        settled = true;
        resolve({
          ok: true,
          message: `Listening on UDP ${config.listenPort}. The link activates when the vehicle sends its first packet.`,
        });
      }
    });

    socket.bind(config.listenPort);
  });
}

export async function disconnect(): Promise<void> {
  const state = getLink();
  if (!state) return;
  if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
  if (state.pendingMission?.timer) clearTimeout(state.pendingMission.timer);
  await new Promise<void>((resolve) => {
    if (!state.socket) return resolve();
    try {
      state.socket.close(() => resolve());
    } catch {
      resolve();
    }
  });
  globalRef.__aiexnetMavLink = undefined;
}

// ---------------------------------------------------------------------------
// Mission upload
// ---------------------------------------------------------------------------

export interface MissionWaypoint {
  latitude: number;
  longitude: number;
  altitudeM: number;
  action: "TAKEOFF" | "WAYPOINT" | "LOITER" | "LAND" | "RTL";
  loiterSeconds?: number;
}

const NAV_COMMAND: Record<MissionWaypoint["action"], number> = {
  TAKEOFF: 22,
  WAYPOINT: 16,
  LOITER: 19,
  LAND: 21,
  RTL: 20,
};

/**
 * Upload a mission with the standard MAVLink mission protocol: announce the
 * count, serve each item as the vehicle requests it, and wait for the
 * vehicle's own acknowledgement.
 *
 * The result reports what the vehicle said, not what we hoped it would say —
 * a timeout is reported as a timeout, with how far the transfer got.
 */
export function uploadMission(
  waypoints: MissionWaypoint[]
): Promise<{ ok: boolean; message: string }> {
  const state = getLink();
  if (!state) return Promise.resolve({ ok: false, message: "No link. Connect first." });
  if (!state.remote) {
    return Promise.resolve({
      ok: false,
      message: "The vehicle has not sent a packet yet, so its address is unknown.",
    });
  }
  if (waypoints.length === 0) {
    return Promise.resolve({ ok: false, message: "Mission is empty." });
  }

  const ids = targetIds(state);
  const items: Payload[] = waypoints.map((w, seq) => ({
    ...ids,
    seq,
    frame: 3, // MAV_FRAME_GLOBAL_RELATIVE_ALT
    command: NAV_COMMAND[w.action],
    current: seq === 0 ? 1 : 0,
    autocontinue: 1,
    param1: w.action === "LOITER" ? w.loiterSeconds ?? 60 : 0,
    param2: 0,
    param3: 0,
    param4: 0,
    x: Math.round(w.latitude * 1e7),
    y: Math.round(w.longitude * 1e7),
    z: w.altitudeM,
    mission_type: 0,
  }));

  return new Promise((resolve) => {
    const pending: PendingMission = {
      items,
      acked: false,
      resolve,
      timer: null,
      highestRequested: -1,
    };
    state.pendingMission = pending;

    pending.timer = setTimeout(() => {
      if (pending.acked) return;
      const served = pending.highestRequested + 1;
      state.pendingMission = null;
      audit(state, {
        action: "MISSION_UPLOAD",
        detail: `${items.length} items`,
        result: "TIMEOUT",
        message: `Vehicle requested ${served}/${items.length} items then stopped responding.`,
      });
      resolve({
        ok: false,
        message: `Timed out. The vehicle requested ${served} of ${items.length} items and then went quiet — check the link and that the autopilot is not busy.`,
      });
    }, 15000);

    audit(state, {
      action: "MISSION_UPLOAD",
      detail: `${items.length} items`,
      result: "SENT",
      message: null,
    });
    send(state, "MISSION_COUNT", { ...ids, count: items.length, mission_type: 0 });
  });
}

// ---------------------------------------------------------------------------
// Flight commands
// ---------------------------------------------------------------------------

function commandLong(state: LinkState, command: number, params: number[]) {
  send(state, "COMMAND_LONG", {
    ...targetIds(state),
    command,
    confirmation: 0,
    param1: params[0] ?? 0,
    param2: params[1] ?? 0,
    param3: params[2] ?? 0,
    param4: params[3] ?? 0,
    param5: params[4] ?? 0,
    param6: params[5] ?? 0,
    param7: params[6] ?? 0,
  });
}

export function setMode(mode: string): { ok: boolean; message: string } {
  const state = getLink();
  if (!state) return { ok: false, message: "No link." };

  const table = modeTable(state);
  const custom = table[mode.toUpperCase()];
  if (custom === undefined) {
    return {
      ok: false,
      message: `Unknown mode "${mode}" for this airframe. Available: ${Object.keys(table).join(", ")}`,
    };
  }

  audit(state, { action: "SET_MODE", detail: mode.toUpperCase(), result: "SENT", message: null });
  commandLong(state, MAV_CMD.DO_SET_MODE, [MAV_MODE_FLAG_CUSTOM_MODE_ENABLED, custom]);
  return {
    ok: true,
    message: `Requested ${mode.toUpperCase()}. The autopilot decides whether to accept it.`,
  };
}

/**
 * Arm or disarm the vehicle.
 *
 * The autopilot runs its own pre-arm checks and refuses if they fail; we
 * surface its refusal rather than reporting success on send.
 */
export function setArmed(armed: boolean): { ok: boolean; message: string } {
  const state = getLink();
  if (!state) return { ok: false, message: "No link." };

  audit(state, {
    action: armed ? "ARM" : "DISARM",
    detail: "",
    result: "SENT",
    message: null,
  });
  commandLong(state, MAV_CMD.COMPONENT_ARM_DISARM, [armed ? 1 : 0]);
  return {
    ok: true,
    message: `${armed ? "Arm" : "Disarm"} requested. Watch STATUSTEXT for the autopilot's own pre-arm result.`,
  };
}

export function startMission(): { ok: boolean; message: string } {
  const state = getLink();
  if (!state) return { ok: false, message: "No link." };
  audit(state, { action: "MISSION_START", detail: "", result: "SENT", message: null });
  commandLong(state, MAV_CMD.MISSION_START, []);
  return { ok: true, message: "Mission start requested." };
}

export function returnToLaunch(): { ok: boolean; message: string } {
  const state = getLink();
  if (!state) return { ok: false, message: "No link." };
  audit(state, { action: "RTL", detail: "", result: "SENT", message: null });
  commandLong(state, MAV_CMD.NAV_RETURN_TO_LAUNCH, []);
  return { ok: true, message: "Return to launch requested." };
}

/**
 * Fly to a single point without replacing the loaded mission.
 *
 * Uses COMMAND_INT so latitude and longitude travel as scaled integers.
 * COMMAND_LONG would carry them as float32, which loses roughly a metre of
 * position precision at these latitudes.
 */
export function repositionTo(
  latitude: number,
  longitude: number,
  altitudeM: number,
  groundSpeedMs = -1
): { ok: boolean; message: string } {
  const state = getLink();
  if (!state) return { ok: false, message: "No link." };

  audit(state, {
    action: "REPOSITION",
    detail: `${latitude.toFixed(6)}, ${longitude.toFixed(6)} @ ${altitudeM} m`,
    result: "SENT",
    message: null,
  });

  send(state, "COMMAND_INT", {
    ...targetIds(state),
    frame: 3, // MAV_FRAME_GLOBAL_RELATIVE_ALT
    command: MAV_CMD.DO_REPOSITION,
    current: 0,
    autocontinue: 0,
    param1: groundSpeedMs,
    param2: 1, // MAV_DO_REPOSITION_FLAGS_CHANGE_MODE
    param3: 0,
    param4: NaN, // keep current yaw
    x: Math.round(latitude * 1e7),
    y: Math.round(longitude * 1e7),
    z: altitudeM,
  });

  return {
    ok: true,
    message:
      "Reposition requested. The vehicle must be in a mode that accepts it — GUIDED on most airframes.",
  };
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export function linkStatus() {
  const state = getLink();
  if (!state) {
    return {
      connected: false,
      message: "No MAVLink link. Connect to a UDP port, then point a vehicle or SITL at it.",
    };
  }

  const now = Date.now();
  const heartbeatAge =
    state.vehicle.lastHeartbeat > 0 ? (now - state.vehicle.lastHeartbeat) / 1000 : null;

  return {
    connected: true,
    listenPort: state.config.listenPort,
    remote: state.remote,
    uptimeSec: Math.round((now - state.connectedAt) / 1000),
    messagesReceived: state.messagesReceived,
    messagesSent: state.messagesSent,
    badChecksums: state.parser.badChecksums,
    unknownMessages: state.parser.unknownMessages,
    lastError: state.lastError,
    vehicle: {
      systemId: state.vehicle.systemId,
      mavType: state.vehicle.mavType,
      airframe:
        state.vehicle.mavType == null ? null : isFixedWing(state) ? "FIXED_WING" : "ROTARY",
      autopilot: state.vehicle.autopilot,
      armed: state.vehicle.armed,
      mode: state.vehicle.mavType == null ? null : modeName(state),
      currentWaypoint: state.vehicle.currentWaypoint,
      homeLatitude: state.vehicle.homeLat,
      homeLongitude: state.vehicle.homeLon,
      heartbeatAgeSec: heartbeatAge == null ? null : Number(heartbeatAge.toFixed(1)),
      heartbeatState:
        heartbeatAge == null
          ? "NONE"
          : heartbeatAge < 3
          ? "LIVE"
          : heartbeatAge < 15
          ? "STALE"
          : "LOST",
    },
    availableModes: state.vehicle.mavType == null ? [] : Object.keys(modeTable(state)),
    statusTexts: state.vehicle.statusTexts.slice(0, 15),
    audit: state.audit.slice(0, 30),
  };
}
