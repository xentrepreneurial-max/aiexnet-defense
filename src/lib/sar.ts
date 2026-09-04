/**
 * Sentinel-1 SAR ship detection and dark-vessel correlation.
 *
 * WHY THIS EXISTS
 * AIS is cooperative: a vessel broadcasts its own position and can simply
 * stop. Synthetic aperture radar does not care — a steel hull on open water
 * is a bright point target against a dark sea surface, day or night, through
 * cloud. Comparing what SAR sees against what AIS reports is the standard way
 * to find vessels operating without AIS.
 *
 * HOW
 * 1. Fetch a Sentinel-1 GRD VV backscatter raster for the requested box from
 *    the Copernicus Data Space Sentinel Hub Process API.
 * 2. Run a cell-averaging CFAR detector over it. CFAR adapts its threshold to
 *    local sea clutter, so it holds up across sea states instead of using one
 *    fixed brightness cut.
 * 3. Cluster detections into targets and convert pixel centroids to lat/lon.
 * 4. Match each target against AIS positions in a time window. A target with
 *    no AIS vessel nearby is reported as DARK.
 *
 * Requires free Copernicus Data Space credentials (CDSE_CLIENT_ID and
 * CDSE_CLIENT_SECRET). Without them this reports NO_KEY and returns nothing.
 */

import { decodePng, toGrayscale } from "./png";
import { haversineKm } from "./airspace";
import { VesselData } from "@/types/intelligence";

const TOKEN_URL =
  "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const PROCESS_URL = "https://sh.dataspace.copernicus.eu/api/v1/process";
const CATALOG_URL = "https://sh.dataspace.copernicus.eu/api/v1/catalog/1.0.0/search";

/** Sea is dark in VV; this scaling keeps hulls near saturation. */
const EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["VV"] }],
    output: { bands: 1, sampleType: "UINT8" }
  };
}
function evaluatePixel(sample) {
  // Sigma0 over calm sea is roughly 0.001-0.02; a metal hull is orders of
  // magnitude brighter. Linear scaling keeps that separation intact.
  return [Math.min(255, Math.round(sample.VV * 500))];
}`;

export interface SarTarget {
  id: string;
  latitude: number;
  longitude: number;
  /** Pixels above the CFAR threshold in this cluster. */
  pixelCount: number;
  /** Peak backscatter value in the cluster, 0-255 after scaling. */
  peak: number;
  /** Approximate along-track extent in metres. */
  approxLengthM: number;
  /** How far above local clutter the peak sat, in standard deviations. */
  snrSigma: number;
}

export interface DarkVesselResult {
  target: SarTarget;
  /** Nearest AIS vessel, if any was close enough in space and time. */
  matchedMmsi: string | null;
  matchedName: string | null;
  matchDistanceM: number | null;
  /**
   * MATCHED       — an AIS report sits within the match radius.
   * DARK          — AIS covered this area and time, and nothing was there.
   * UNCORRELATED  — no AIS coverage for the acquisition time, so we cannot
   *                 say anything about this target. Never call it dark.
   */
  status: "MATCHED" | "DARK" | "UNCORRELATED";
}

// ---------------------------------------------------------------------------
// CFAR detection — pure, so it can be tested without any network access
// ---------------------------------------------------------------------------

export interface CfarOptions {
  /** Half-width of the background ring, in pixels. */
  backgroundRadius: number;
  /** Half-width of the guard band excluded from the background estimate. */
  guardRadius: number;
  /** Detection threshold in standard deviations above local mean. */
  thresholdSigma: number;
  /** Reject clusters smaller than this — single hot pixels are usually noise. */
  minClusterPixels: number;
  /**
   * Minimum target-to-clutter ratio. SAR speckle is multiplicative, so a
   * Gaussian sigma test alone under-rejects it; requiring the pixel to be this
   * many times the local background mean is the scene-independent guard.
   */
  minContrastRatio: number;
}

/**
 * Defaults tuned for Sentinel-1 IW GRD at roughly 10 m ground sample distance.
 *
 * The guard band MUST be wider than the largest vessel you expect to detect.
 * If it is not, the ship's own bright pixels land in its background estimate,
 * inflate the local mean, and the target hides itself — a real failure mode
 * that cost this detector its largest target before the guard was widened.
 * 12 px guard ≈ 240 m, comfortably past a Panamax hull.
 */
export const DEFAULT_CFAR: CfarOptions = {
  backgroundRadius: 30, // ≈ 600 m of sea clutter
  guardRadius: 12, // ≈ 240 m, wider than any expected hull
  thresholdSigma: 5.0,
  minClusterPixels: 3,
  /**
   * Ships sit well above 10 dB over sea clutter. Measured on an empty
   * Bay of Bengal box, sea speckle peaked at 79 DN against a background of a
   * few DN and produced 382 false detections under a sigma-only test; a
   * ratio gate removes that population without touching real returns, which
   * saturate this scaling.
   */
  minContrastRatio: 8.0,
};

/** Summed-area table, so any window sum is four lookups regardless of size. */
function integralImage(
  src: Float32Array,
  width: number,
  height: number,
  square: boolean
): Float64Array {
  const w = width + 1;
  const out = new Float64Array(w * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      const v = src[y * width + x];
      rowSum += square ? v * v : v;
      out[(y + 1) * w + (x + 1)] = out[y * w + (x + 1)] + rowSum;
    }
  }
  return out;
}

/** Inclusive box sum from a summed-area table, clamped to the image. */
function boxSum(
  ii: Float64Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const w = width + 1;
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(width - 1, x1);
  const cy1 = Math.min(height - 1, y1);
  if (cx1 < cx0 || cy1 < cy0) return 0;
  return (
    ii[(cy1 + 1) * w + (cx1 + 1)] -
    ii[cy0 * w + (cx1 + 1)] -
    ii[(cy1 + 1) * w + cx0] +
    ii[cy0 * w + cx0]
  );
}

function boxCount(
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): number {
  const cx0 = Math.max(0, x0);
  const cy0 = Math.max(0, y0);
  const cx1 = Math.min(width - 1, x1);
  const cy1 = Math.min(height - 1, y1);
  if (cx1 < cx0 || cy1 < cy0) return 0;
  return (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
}

/**
 * Cell-averaging CFAR.
 *
 * The mean and standard deviation of a ring around each pixel — outer box
 * minus guard box, so the target cannot pollute its own background — give a
 * local clutter estimate. A pixel is a detection when it exceeds that mean by
 * `thresholdSigma` standard deviations.
 *
 * Window statistics come from summed-area tables, so the cost is independent
 * of the window radius. That is what makes a guard band wide enough for large
 * vessels affordable.
 */
/**
 * Land mask derived from the scene itself.
 *
 * WHY: SAR ship detection over a coastal box is meaningless without one. Land
 * is bright in SAR — every village, embankment and hill slope — so a CFAR run
 * over a box containing coastline reports hundreds of "targets" that are
 * simply the shore. A first run over the Chittagong approaches returned 202
 * detections, essentially all of them land.
 *
 * HOW: open water has low, homogeneous backscatter; land is bright over large
 * contiguous areas; a ship is bright but small. Smoothing at a scale far
 * larger than any vessel therefore keeps land bright and washes ships out.
 * The smoothed image is split into water and land with Otsu's threshold, the
 * standard choice for this bimodal separation, and the land side is then
 * buffered so harbour structures and surf on the shoreline are excluded too.
 *
 * The Copernicus DEM would give a surveyed mask instead, but the DEM
 * collection is not authorised for this account (HTTP 403), so the mask is
 * derived from the radar image and reported as approximate.
 */
export interface LandMaskResult {
  mask: Uint8Array;
  waterFraction: number;
  threshold: number;
  /** Otsu separability; below the bimodality floor the scene is all water. */
  separability: number;
  /** Backscatter gap between the two classes, in scaled digital numbers. */
  classGap: number;
  landDetected: boolean;
  smoothWindowM: number;
  bufferM: number;
}

interface OtsuResult {
  threshold: number;
  /** Otsu separability, between-class variance over total variance, 0..1. */
  separability: number;
  /** Mean of the darker class. */
  meanLow: number;
  /** Mean of the brighter class. */
  meanHigh: number;
}

/** Otsu's method over a 256-bin histogram of the smoothed scene. */
function otsuThreshold(values: Float32Array): OtsuResult {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < values.length; i++) {
    const v = Math.max(0, Math.min(255, Math.round(values[i])));
    hist[v]++;
  }
  const total = values.length;
  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  const mean = sum / total;
  let totalVar = 0;
  for (let t = 0; t < 256; t++) totalVar += hist[t] * (t - mean) * (t - mean);
  totalVar /= total;

  let sumB = 0;
  let wB = 0;
  let best = 0;
  let bestVar = -1;
  let bestLow = 0;
  let bestHigh = 0;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = (wB / total) * (wF / total) * (mB - mF) * (mB - mF);
    if (between > bestVar) {
      bestVar = between;
      best = t;
      bestLow = mB;
      bestHigh = mF;
    }
  }

  return {
    threshold: best,
    separability: totalVar > 0 ? bestVar / totalVar : 0,
    meanLow: bestLow,
    meanHigh: bestHigh,
  };
}

export function buildLandMask(
  gray: Float32Array,
  width: number,
  height: number,
  metresPerPixel: number,
  smoothWindowM = 2000,
  bufferM = 300
): LandMaskResult {
  const ii = integralImage(gray, width, height, false);

  // Half-width of the smoothing window, in pixels, floored so tiny rasters
  // still get some smoothing.
  const r = Math.max(2, Math.round(smoothWindowM / 2 / Math.max(metresPerPixel, 1)));

  const smoothed = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sum = boxSum(ii, width, height, x - r, y - r, x + r, y + r);
      const n = boxCount(width, height, x - r, y - r, x + r, y + r);
      smoothed[y * width + x] = n > 0 ? sum / n : 0;
    }
  }

  const otsu = otsuThreshold(smoothed);

  /**
   * Otsu always returns a split, even when there is nothing to split. Over an
   * all-water box it divides calm sea into "darker sea" and "brighter sea" and
   * calls the second one land — an open-ocean box came back as 1.3% water
   * before this guard existed.
   *
   * A genuine land/water scene is strongly bimodal AND the two classes sit far
   * apart in backscatter. Require both before accepting any land at all.
   */
  const MIN_SEPARABILITY = 0.62;
  const MIN_CLASS_GAP = 18; // digital numbers in the 0-255 scaled backscatter
  const classGap = otsu.meanHigh - otsu.meanLow;
  const bimodal = otsu.separability >= MIN_SEPARABILITY && classGap >= MIN_CLASS_GAP;

  const raw = new Uint8Array(width * height);
  if (bimodal) {
    for (let i = 0; i < raw.length; i++) raw[i] = smoothed[i] > otsu.threshold ? 1 : 0;
  }

  if (!bimodal) {
    return {
      mask: raw, // all zero: nothing is masked, the whole box is water
      waterFraction: 1,
      threshold: otsu.threshold,
      separability: Number(otsu.separability.toFixed(3)),
      classGap: Number(classGap.toFixed(1)),
      landDetected: false,
      smoothWindowM,
      bufferM,
    };
  }

  // Buffer the land outward so shoreline clutter is excluded as well.
  const br = Math.max(1, Math.round(bufferM / Math.max(metresPerPixel, 1)));
  const maskFloat = new Float32Array(raw.length);
  for (let i = 0; i < raw.length; i++) maskFloat[i] = raw[i];
  const iiMask = integralImage(maskFloat, width, height, false);

  const mask = new Uint8Array(width * height);
  let water = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const near = boxSum(iiMask, width, height, x - br, y - br, x + br, y + br);
      const isLand = near > 0 ? 1 : 0;
      mask[y * width + x] = isLand;
      if (!isLand) water++;
    }
  }

  return {
    mask,
    waterFraction: water / (width * height),
    threshold: otsu.threshold,
    separability: Number(otsu.separability.toFixed(3)),
    classGap: Number(classGap.toFixed(1)),
    landDetected: true,
    smoothWindowM,
    bufferM,
  };
}

export function cfarDetect(
  gray: Float32Array,
  width: number,
  height: number,
  opts: CfarOptions = DEFAULT_CFAR,
  /** Optional land mask: 1 means excluded from detection. */
  exclude?: Uint8Array
): Uint8Array {
  const { backgroundRadius: R, guardRadius: G, thresholdSigma: K } = opts;
  const mask = new Uint8Array(width * height);

  const ii = integralImage(gray, width, height, false);
  const ii2 = integralImage(gray, width, height, true);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (exclude && exclude[y * width + x]) continue;

      const outerSum = boxSum(ii, width, height, x - R, y - R, x + R, y + R);
      const outerSq = boxSum(ii2, width, height, x - R, y - R, x + R, y + R);
      const outerN = boxCount(width, height, x - R, y - R, x + R, y + R);

      const guardSum = boxSum(ii, width, height, x - G, y - G, x + G, y + G);
      const guardSq = boxSum(ii2, width, height, x - G, y - G, x + G, y + G);
      const guardN = boxCount(width, height, x - G, y - G, x + G, y + G);

      const n = outerN - guardN;
      if (n < 32) continue; // too little background to trust an estimate

      const mean = (outerSum - guardSum) / n;
      const variance = Math.max(0, (outerSq - guardSq) / n - mean * mean);
      const sd = Math.sqrt(variance);

      // Uniform background gives sd 0; require a real floor so flat areas do
      // not produce detections from rounding alone.
      const threshold = mean + K * Math.max(sd, 1.0);
      const centre = gray[y * width + x];

      // Both tests must pass: above local statistics, and a genuine
      // target-to-clutter ratio rather than a speckle spike.
      const contrastOk = centre >= Math.max(mean, 0.5) * opts.minContrastRatio;
      if (centre > threshold && contrastOk) mask[y * width + x] = 1;
    }
  }

  return mask;
}

/** Group adjacent detected pixels into targets (8-connected flood fill). */
export function clusterDetections(
  mask: Uint8Array,
  gray: Float32Array,
  width: number,
  height: number,
  bbox: [number, number, number, number], // minLon, minLat, maxLon, maxLat
  opts: CfarOptions = DEFAULT_CFAR
): SarTarget[] {
  const seen = new Uint8Array(width * height);
  const targets: SarTarget[] = [];
  const [minLon, minLat, maxLon, maxLat] = bbox;

  // Ground sample distance implied by the requested box and raster size.
  const spanKmX = haversineKm((minLat + maxLat) / 2, minLon, (minLat + maxLat) / 2, maxLon);
  const spanKmY = haversineKm(minLat, (minLon + maxLon) / 2, maxLat, (minLon + maxLon) / 2);
  const metresPerPxX = (spanKmX * 1000) / width;
  const metresPerPxY = (spanKmY * 1000) / height;

  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || seen[i]) continue;

    const stack = [i];
    seen[i] = 1;
    const pixels: number[] = [];
    let peak = 0;

    while (stack.length) {
      const idx = stack.pop()!;
      pixels.push(idx);
      if (gray[idx] > peak) peak = gray[idx];

      const px = idx % width;
      const py = (idx - px) / width;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (mask[nIdx] && !seen[nIdx]) {
            seen[nIdx] = 1;
            stack.push(nIdx);
          }
        }
      }
    }

    if (pixels.length < opts.minClusterPixels) continue;

    let sx = 0;
    let sy = 0;
    let minPx = Infinity;
    let maxPx = -Infinity;
    let minPy = Infinity;
    let maxPy = -Infinity;
    for (const idx of pixels) {
      const px = idx % width;
      const py = (idx - px) / width;
      sx += px;
      sy += py;
      if (px < minPx) minPx = px;
      if (px > maxPx) maxPx = px;
      if (py < minPy) minPy = py;
      if (py > maxPy) maxPy = py;
    }
    const cx = sx / pixels.length;
    const cy = sy / pixels.length;

    // Pixel row 0 is the north edge of the box.
    const lon = minLon + (cx / width) * (maxLon - minLon);
    const lat = maxLat - (cy / height) * (maxLat - minLat);

    const extentX = (maxPx - minPx + 1) * metresPerPxX;
    const extentY = (maxPy - minPy + 1) * metresPerPxY;

    // Local background around the cluster, for a reported SNR.
    let bgSum = 0;
    let bgSq = 0;
    let bgN = 0;
    const r = opts.backgroundRadius * 2;
    for (let yy = Math.max(0, Math.round(cy) - r); yy <= Math.min(height - 1, Math.round(cy) + r); yy++) {
      for (let xx = Math.max(0, Math.round(cx) - r); xx <= Math.min(width - 1, Math.round(cx) + r); xx++) {
        if (mask[yy * width + xx]) continue;
        const v = gray[yy * width + xx];
        bgSum += v;
        bgSq += v * v;
        bgN++;
      }
    }
    const bgMean = bgN ? bgSum / bgN : 0;
    const bgSd = bgN ? Math.sqrt(Math.max(0, bgSq / bgN - bgMean * bgMean)) : 0;

    targets.push({
      id: `sar-${lat.toFixed(5)}-${lon.toFixed(5)}`,
      latitude: Number(lat.toFixed(5)),
      longitude: Number(lon.toFixed(5)),
      pixelCount: pixels.length,
      peak: Math.round(peak),
      approxLengthM: Math.round(Math.max(extentX, extentY)),
      snrSigma: Number(((peak - bgMean) / Math.max(bgSd, 1)).toFixed(1)),
    });
  }

  return targets;
}

/**
 * Match SAR targets against AIS. A target with no AIS vessel within
 * `radiusM` is reported dark.
 *
 * The radius has to absorb two real errors: the SAR geolocation itself, and
 * the fact that the AIS position was reported at a different instant than the
 * radar acquisition.
 */
export function correlateWithAis(
  targets: SarTarget[],
  vessels: VesselData[],
  /**
   * Whether AIS actually covered this area at the acquisition time. Without
   * coverage a radar target says nothing about concealment, so the result is
   * UNCORRELATED rather than DARK.
   */
  aisCovered: boolean,
  radiusM = 800
): DarkVesselResult[] {
  return targets.map((target) => {
    let best: { v: VesselData; d: number } | null = null;
    for (const v of vessels) {
      const d = haversineKm(target.latitude, target.longitude, v.latitude, v.longitude) * 1000;
      if (!best || d < best.d) best = { v, d };
    }

    const matched = best && best.d <= radiusM ? best : null;
    return {
      target,
      matchedMmsi: matched ? matched.v.mmsi : null,
      matchedName: matched ? matched.v.name : null,
      matchDistanceM: best ? Math.round(best.d) : null,
      status: matched ? "MATCHED" : aisCovered ? "DARK" : "UNCORRELATED",
    };
  });
}

// ---------------------------------------------------------------------------
// Copernicus Data Space access
// ---------------------------------------------------------------------------

interface TokenCache {
  token: string;
  expiresAt: number;
}
const globalRef = globalThis as unknown as { __aiexnetCdseToken?: TokenCache };

async function getAccessToken(): Promise<string | null> {
  const id = process.env.CDSE_CLIENT_ID;
  const secret = process.env.CDSE_CLIENT_SECRET;
  if (!id || !secret) return null;

  const cached = globalRef.__aiexnetCdseToken;
  if (cached && Date.now() < cached.expiresAt - 30_000) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: id,
    client_secret: secret,
  });

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`CDSE token request failed: HTTP ${res.status} ${await res.text()}`);
  }
  const json = await res.json();
  const token = json.access_token as string;
  globalRef.__aiexnetCdseToken = {
    token,
    expiresAt: Date.now() + (json.expires_in ?? 600) * 1000,
  };
  return token;
}

export interface SarRequest {
  /** minLon, minLat, maxLon, maxLat */
  bbox: [number, number, number, number];
  /** How far back to look for an acquisition. */
  /** How far back to accept an acquisition. Sentinel-1 revisits every few days. */
  lookbackHours: number;
  /** Raster size; larger sees smaller vessels but costs more processing. */
  size: number;
}

export interface SarScene {
  /** ISO timestamp of the radar acquisition itself. */
  datetime: string;
  id: string;
  orbitState: string | null;
  polarizations: string[] | null;
}

/**
 * Newest Sentinel-1 acquisition covering the box.
 *
 * Knowing WHEN the radar looked is not optional: correlating a five-day-old
 * image against this minute's AIS would call every ship in it "dark" simply
 * because it has since sailed away.
 */
export async function findLatestScene(
  bbox: [number, number, number, number],
  lookbackHours: number
): Promise<SarScene | null> {
  const token = await getAccessToken();
  if (!token) throw new Error("CDSE credentials not configured");

  const to = new Date();
  const from = new Date(to.getTime() - lookbackHours * 3600_000);

  const res = await fetch(CATALOG_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: ["sentinel-1-grd"],
      bbox,
      datetime: `${from.toISOString()}/${to.toISOString()}`,
      limit: 10,
    }),
  });
  if (!res.ok) throw new Error(`Catalog search failed: HTTP ${res.status}`);

  const json = await res.json();
  const features: any[] = json?.features ?? [];
  if (features.length === 0) return null;

  features.sort((a, b) =>
    String(b.properties?.datetime).localeCompare(String(a.properties?.datetime))
  );
  const f = features[0];
  return {
    datetime: String(f.properties?.datetime),
    id: String(f.id ?? ""),
    orbitState: f.properties?.["sat:orbit_state"] ?? null,
    polarizations: f.properties?.polarizations ?? f.properties?.["sar:polarizations"] ?? null,
  };
}

export interface SarScanResult {
  targets: SarTarget[];
  raster: { width: number; height: number };
  bbox: [number, number, number, number];
  timeRange: { from: string; to: string };
  /** The acquisition this result actually came from. */
  scene: SarScene | null;
  metresPerPixel: number;
  /** Share of the box that was actually searched, after masking land. */
  waterFraction: number;
  landMask: {
    method: string;
    landDetected: boolean;
    otsuThreshold: number;
    separability: number;
    classGap: number;
    smoothWindowM: number;
    shorelineBufferM: number;
  };
  /** Populated when the request geometry makes the result unreliable. */
  warnings: string[];
}

export async function scanSar(req: SarRequest): Promise<SarScanResult> {
  const token = await getAccessToken();
  if (!token) throw new Error("CDSE credentials not configured");

  // Find the actual acquisition first, then pin the image request to it so we
  // read one pass rather than a blend, and know its timestamp.
  const scene = await findLatestScene(req.bbox, req.lookbackHours);
  if (!scene) {
    throw new Error(
      `No Sentinel-1 acquisition covers this box in the last ${req.lookbackHours} h. Sentinel-1 revisits every few days — widen the lookback.`
    );
  }

  const sceneMs = Date.parse(scene.datetime);
  const from = new Date(sceneMs - 10 * 60_000);
  const to = new Date(sceneMs + 10 * 60_000);

  const payload = {
    input: {
      bounds: {
        bbox: req.bbox,
        properties: { crs: "http://www.opengis.net/def/crs/EPSG/0/4326" },
      },
      data: [
        {
          type: "sentinel-1-grd",
          dataFilter: {
            timeRange: { from: from.toISOString(), to: to.toISOString() },
            acquisitionMode: "IW",
            polarization: "DV",
            // Take the latest pass rather than blending several into one
            // image, which would place ships from different days side by side.
            mosaickingOrder: "mostRecent",
          },
          processing: { backCoeff: "SIGMA0_ELLIPSOID", orthorectify: true },
        },
      ],
    },
    output: {
      width: req.size,
      height: req.size,
      responses: [{ identifier: "default", format: { type: "image/png" } }],
    },
    evalscript: EVALSCRIPT,
  };

  const res = await fetch(PROCESS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "image/png",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    throw new Error(`Sentinel Hub process failed: HTTP ${res.status} ${await res.text()}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  const img = decodePng(buffer);
  const gray = toGrayscale(img);

  const [minLon, minLat, maxLon, maxLat] = req.bbox;
  const spanKm = haversineKm((minLat + maxLat) / 2, minLon, (minLat + maxLat) / 2, maxLon);
  const metresPerPixel = (spanKm * 1000) / img.width;

  const warnings: string[] = [];
  // Sentinel-1 IW GRD is 10 m native. Beyond roughly 30 m per pixel a vessel
  // is only a pixel or two and detection becomes unreliable, so say so
  // instead of returning confident-looking noise.
  if (metresPerPixel > 30) {
    warnings.push(
      `Ground sample distance is ${metresPerPixel.toFixed(0)} m/px. Sentinel-1 resolves about 10 m, so vessels under roughly ${Math.round(metresPerPixel * 3)} m may be missed. Use a smaller box or a larger raster.`
    );
  }

  const land = buildLandMask(gray, img.width, img.height, metresPerPixel);
  if (land.waterFraction < 0.15) {
    warnings.push(
      `Only ${(land.waterFraction * 100).toFixed(0)}% of this box is open water. Ship detection is meaningful over water, so most of the area was not searched.`
    );
  }

  const mask = cfarDetect(gray, img.width, img.height, DEFAULT_CFAR, land.mask);
  const targets = clusterDetections(mask, gray, img.width, img.height, req.bbox);

  return {
    targets,
    raster: { width: img.width, height: img.height },
    bbox: req.bbox,
    timeRange: { from: from.toISOString(), to: to.toISOString() },
    scene,
    metresPerPixel: Number(metresPerPixel.toFixed(1)),
    waterFraction: Number(land.waterFraction.toFixed(3)),
    landMask: {
      method:
        "Derived from the radar scene: large-scale smoothing plus an Otsu split, then a shoreline buffer. Approximate — the surveyed Copernicus DEM mask is not authorised for this account.",
      landDetected: land.landDetected,
      otsuThreshold: land.threshold,
      separability: land.separability,
      classGap: land.classGap,
      smoothWindowM: land.smoothWindowM,
      shorelineBufferM: land.bufferM,
    },
    warnings,
  };
}

export function sarConfigured(): boolean {
  return Boolean(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);
}
