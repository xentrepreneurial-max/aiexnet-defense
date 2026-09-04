/**
 * Minimal PNG decoder.
 *
 * Sentinel Hub returns processed rasters as PNG. Node has no built-in image
 * decoding, so this reads the pixels directly: it handles 8-bit greyscale,
 * RGB and RGBA, non-interlaced, which is what the Process API produces for
 * the evalscripts used here. Decompression uses node:zlib.
 *
 * Anything outside that (16-bit, palette, interlaced) throws rather than
 * silently returning wrong pixel values.
 */

import { inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  channels: number;
  /** Row-major, `channels` bytes per pixel. */
  data: Uint8Array;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buffer: Buffer): DecodedImage {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (buffer[i] !== PNG_SIGNATURE[i]) throw new Error("Not a PNG file");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  const idatParts: Buffer[] = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;

    if (type === "IHDR") {
      width = buffer.readUInt32BE(dataStart);
      height = buffer.readUInt32BE(dataStart + 4);
      bitDepth = buffer[dataStart + 8];
      colorType = buffer[dataStart + 9];
      interlace = buffer[dataStart + 12];
    } else if (type === "IDAT") {
      idatParts.push(buffer.subarray(dataStart, dataStart + length));
    } else if (type === "IEND") {
      break;
    }

    offset = dataStart + length + 4; // skip CRC
  }

  if (bitDepth !== 8) throw new Error(`Unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error("Interlaced PNG is not supported");

  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const channels = channelsByType[colorType];
  if (!channels) throw new Error(`Unsupported PNG colour type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idatParts));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);

  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const rowStart = y * stride;
    const prevStart = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const rawByte = raw[pos++];
      const a = x >= channels ? out[rowStart + x - channels] : 0; // left
      const b = y > 0 ? out[prevStart + x] : 0; // above
      const c = x >= channels && y > 0 ? out[prevStart + x - channels] : 0; // upper-left

      let value: number;
      switch (filter) {
        case 0:
          value = rawByte;
          break;
        case 1:
          value = rawByte + a;
          break;
        case 2:
          value = rawByte + b;
          break;
        case 3:
          value = rawByte + ((a + b) >> 1);
          break;
        case 4:
          value = rawByte + paethPredictor(a, b, c);
          break;
        default:
          throw new Error(`Unknown PNG filter type ${filter}`);
      }
      out[rowStart + x] = value & 0xff;
    }
  }

  return { width, height, channels, data: out };
}

/** Collapse to a single luminance plane for detection work. */
export function toGrayscale(img: DecodedImage): Float32Array {
  const { width, height, channels, data } = img;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (channels === 1 || channels === 2) {
      gray[i] = data[i * channels];
    } else {
      const r = data[i * channels];
      const g = data[i * channels + 1];
      const b = data[i * channels + 2];
      gray[i] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }
  return gray;
}
