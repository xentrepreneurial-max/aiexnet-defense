/**
 * MAVLink v2 wire codec.
 *
 * Frames, checksums and payload packing for the message subset defined in
 * messages.ts. Verified byte-for-byte against pymavlink, the reference
 * implementation, in tools/verify-mavlink.mjs.
 *
 * This is the layer that decides whether a real autopilot understands us, so
 * it is deliberately strict: an unknown message id, a bad checksum or a short
 * payload is reported rather than guessed at.
 */

import { MESSAGES, MessageDef, FieldType } from "./messages";

export const MAVLINK2_MAGIC = 0xfd;
const INCOMPAT_FLAG_SIGNED = 0x01;

const TYPE_SIZE: Record<FieldType, number> = {
  uint8_t: 1,
  int8_t: 1,
  char: 1,
  uint16_t: 2,
  int16_t: 2,
  uint32_t: 4,
  int32_t: 4,
  float: 4,
  uint64_t: 8,
  int64_t: 8,
  double: 8,
};

/** CRC-16/MCRF4XX, the checksum MAVLink uses. */
export function crc16Mcrf4xx(bytes: Uint8Array, start = 0xffff): number {
  let crc = start;
  for (let i = 0; i < bytes.length; i++) {
    let tmp = (bytes[i] ^ (crc & 0xff)) & 0xff;
    tmp = (tmp ^ (tmp << 4)) & 0xff;
    crc = ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
  }
  return crc;
}

function crcAccumulate(byte: number, crc: number): number {
  let tmp = (byte ^ (crc & 0xff)) & 0xff;
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export type FieldValue = number | bigint | string | number[];
export type Payload = Record<string, FieldValue>;

function payloadSize(def: MessageDef): number {
  return def.fields.reduce(
    (sum, f) => sum + TYPE_SIZE[f.type] * Math.max(1, f.arrayLength),
    0
  );
}

function writeScalar(
  view: DataView,
  offset: number,
  type: FieldType,
  value: number | bigint
) {
  switch (type) {
    case "uint8_t":
    case "char":
      view.setUint8(offset, Number(value) & 0xff);
      break;
    case "int8_t":
      view.setInt8(offset, Number(value));
      break;
    case "uint16_t":
      view.setUint16(offset, Number(value) & 0xffff, true);
      break;
    case "int16_t":
      view.setInt16(offset, Number(value), true);
      break;
    case "uint32_t":
      view.setUint32(offset, Number(value) >>> 0, true);
      break;
    case "int32_t":
      view.setInt32(offset, Number(value) | 0, true);
      break;
    case "float":
      view.setFloat32(offset, Number(value), true);
      break;
    case "double":
      view.setFloat64(offset, Number(value), true);
      break;
    case "uint64_t":
      view.setBigUint64(offset, BigInt(value), true);
      break;
    case "int64_t":
      view.setBigInt64(offset, BigInt(value), true);
      break;
  }
}

function readScalar(view: DataView, offset: number, type: FieldType): number | bigint {
  switch (type) {
    case "uint8_t":
    case "char":
      return view.getUint8(offset);
    case "int8_t":
      return view.getInt8(offset);
    case "uint16_t":
      return view.getUint16(offset, true);
    case "int16_t":
      return view.getInt16(offset, true);
    case "uint32_t":
      return view.getUint32(offset, true);
    case "int32_t":
      return view.getInt32(offset, true);
    case "float":
      return view.getFloat32(offset, true);
    case "double":
      return view.getFloat64(offset, true);
    case "uint64_t":
      return view.getBigUint64(offset, true);
    case "int64_t":
      return view.getBigInt64(offset, true);
  }
}

export function encodePayload(def: MessageDef, values: Payload): Uint8Array {
  const buffer = new Uint8Array(payloadSize(def));
  const view = new DataView(buffer.buffer);
  let offset = 0;

  for (const field of def.fields) {
    const size = TYPE_SIZE[field.type];
    const raw = values[field.name];

    if (field.arrayLength > 0) {
      if (field.type === "char") {
        // Char arrays are fixed-width, NUL-padded strings.
        const text = typeof raw === "string" ? raw : "";
        for (let i = 0; i < field.arrayLength; i++) {
          view.setUint8(offset + i, i < text.length ? text.charCodeAt(i) & 0xff : 0);
        }
      } else {
        const arr = Array.isArray(raw) ? raw : [];
        for (let i = 0; i < field.arrayLength; i++) {
          writeScalar(view, offset + i * size, field.type, arr[i] ?? 0);
        }
      }
      offset += size * field.arrayLength;
    } else {
      writeScalar(view, offset, field.type, (raw as number | bigint) ?? 0);
      offset += size;
    }
  }

  return buffer;
}

export function decodePayload(def: MessageDef, payload: Uint8Array): Payload {
  // v2 truncates trailing zero bytes; pad back so field offsets line up.
  const full = new Uint8Array(payloadSize(def));
  full.set(payload.subarray(0, Math.min(payload.length, full.length)));
  const view = new DataView(full.buffer);

  const out: Payload = {};
  let offset = 0;

  for (const field of def.fields) {
    const size = TYPE_SIZE[field.type];
    if (field.arrayLength > 0) {
      if (field.type === "char") {
        let text = "";
        for (let i = 0; i < field.arrayLength; i++) {
          const code = view.getUint8(offset + i);
          if (code === 0) break;
          text += String.fromCharCode(code);
        }
        out[field.name] = text;
      } else {
        const arr: number[] = [];
        for (let i = 0; i < field.arrayLength; i++) {
          arr.push(Number(readScalar(view, offset + i * size, field.type)));
        }
        out[field.name] = arr;
      }
      offset += size * field.arrayLength;
    } else {
      const v = readScalar(view, offset, field.type);
      out[field.name] = typeof v === "bigint" ? Number(v) : v;
      offset += size;
    }
  }

  return out;
}

export interface EncodeOptions {
  systemId: number;
  componentId: number;
  sequence: number;
}

export function encodeMessage(
  msgid: number,
  values: Payload,
  opts: EncodeOptions
): Uint8Array {
  const def = MESSAGES[msgid];
  if (!def) throw new Error(`Unknown MAVLink message id ${msgid}`);

  const payload = encodePayload(def, values);

  // v2 trims trailing zero bytes from the payload.
  let length = payload.length;
  while (length > 0 && payload[length - 1] === 0) length--;
  const trimmed = payload.subarray(0, length);

  const frame = new Uint8Array(10 + length + 2);
  frame[0] = MAVLINK2_MAGIC;
  frame[1] = length;
  frame[2] = 0; // incompat_flags — unsigned frames only
  frame[3] = 0; // compat_flags
  frame[4] = opts.sequence & 0xff;
  frame[5] = opts.systemId & 0xff;
  frame[6] = opts.componentId & 0xff;
  frame[7] = msgid & 0xff;
  frame[8] = (msgid >> 8) & 0xff;
  frame[9] = (msgid >> 16) & 0xff;
  frame.set(trimmed, 10);

  // Checksum covers everything after the magic byte, then the CRC extra.
  let crc = crc16Mcrf4xx(frame.subarray(1, 10 + length));
  crc = crcAccumulate(def.crcExtra, crc);
  frame[10 + length] = crc & 0xff;
  frame[11 + length] = (crc >> 8) & 0xff;

  return frame;
}

export interface DecodedMessage {
  name: string;
  msgid: number;
  systemId: number;
  componentId: number;
  sequence: number;
  payload: Payload;
}

/**
 * Streaming frame parser.
 *
 * Autopilot links deliver partial frames and occasional noise, so this buffers
 * across calls and resynchronises on the magic byte rather than assuming each
 * datagram holds exactly one whole message.
 */
export class MavlinkParser {
  private buffer: Uint8Array = new Uint8Array(0);

  /** Frames dropped because their checksum did not match. */
  public badChecksums = 0;
  /** Frames whose message id is not in our table. */
  public unknownMessages = 0;
  public framesParsed = 0;

  push(chunk: Uint8Array): DecodedMessage[] {
    const merged = new Uint8Array(this.buffer.length + chunk.length);
    merged.set(this.buffer);
    merged.set(chunk, this.buffer.length);
    this.buffer = merged;

    const out: DecodedMessage[] = [];

    while (this.buffer.length > 0) {
      // Resynchronise on the v2 magic byte.
      const start = this.buffer.indexOf(MAVLINK2_MAGIC);
      if (start === -1) {
        this.buffer = new Uint8Array(0);
        break;
      }
      if (start > 0) this.buffer = this.buffer.subarray(start);
      if (this.buffer.length < 12) break; // not enough for a header + checksum

      const length = this.buffer[1];
      const incompat = this.buffer[2];
      const signatureLength = incompat & INCOMPAT_FLAG_SIGNED ? 13 : 0;
      const frameLength = 10 + length + 2 + signatureLength;
      if (this.buffer.length < frameLength) break;

      const frame = this.buffer.subarray(0, frameLength);
      const msgid = frame[7] | (frame[8] << 8) | (frame[9] << 16);
      const def = MESSAGES[msgid];

      if (!def) {
        this.unknownMessages++;
        this.buffer = this.buffer.subarray(frameLength);
        continue;
      }

      let crc = crc16Mcrf4xx(frame.subarray(1, 10 + length));
      crc = crcAccumulate(def.crcExtra, crc);
      const frameCrc = frame[10 + length] | (frame[11 + length] << 8);

      if (crc !== frameCrc) {
        // Bad checksum: skip only the magic byte so a real frame that starts
        // inside this one is still found.
        this.badChecksums++;
        this.buffer = this.buffer.subarray(1);
        continue;
      }

      out.push({
        name: def.name,
        msgid,
        systemId: frame[5],
        componentId: frame[6],
        sequence: frame[4],
        payload: decodePayload(def, frame.subarray(10, 10 + length)),
      });
      this.framesParsed++;
      this.buffer = this.buffer.subarray(frameLength);
    }

    // Keep the tail as its own copy so we do not retain the whole merged view.
    this.buffer = Uint8Array.from(this.buffer);
    return out;
  }
}
