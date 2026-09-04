/**
 * Airspace and maritime boundary geometry.
 *
 * IMPORTANT: these polygons are hand-digitised approximations intended for
 * situational display and proximity alerting. They are not surveyed
 * boundaries and must not be used as a legal or navigational reference.
 * Every label rendered from them is marked "approx.".
 */

export type Ring = Array<[number, number]>; // [lon, lat]

/** Approximate Bangladesh land border. */
export const BD_LAND_BORDER: Ring = [
  [88.02, 26.63], [88.55, 26.40], [88.90, 26.30], [89.70, 26.10],
  [89.85, 25.50], [90.50, 25.18], [91.80, 25.15], [92.40, 25.05],
  [92.50, 24.80], [92.20, 24.20], [92.35, 23.80], [92.65, 23.70],
  [92.40, 22.80], [92.60, 22.10], [92.40, 21.30], [92.30, 20.80],
  [92.15, 20.55], [91.95, 21.45], [91.40, 22.20], [90.50, 21.90],
  [89.50, 21.70], [89.15, 21.65], [88.90, 22.50], [88.80, 23.30],
  [88.60, 24.20], [88.20, 24.80], [88.05, 25.20], [88.35, 25.80],
  [88.02, 26.63],
];

/** Approximate Dhaka FIR / air defence identification envelope. */
export const BD_ADIZ: Ring = [
  [87.50, 26.80], [89.00, 27.20], [92.80, 26.00], [93.20, 24.20],
  [93.00, 21.00], [92.50, 20.20], [89.50, 19.50], [87.50, 20.50],
  [87.50, 26.80],
];

/** Approximate Bangladesh maritime EEZ envelope in the Bay of Bengal. */
export const BD_EEZ: Ring = [
  [89.15, 21.65], [89.10, 19.20], [91.10, 17.50], [92.40, 19.80],
  [92.35, 20.80], [89.15, 21.65],
];

/** Standard ray-casting point-in-polygon. Ring is [lon, lat] pairs. */
export function pointInRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

export function isInAdiz(lon: number, lat: number): boolean {
  return pointInRing(lon, lat, BD_ADIZ);
}

export function isOverBangladesh(lon: number, lat: number): boolean {
  return pointInRing(lon, lat, BD_LAND_BORDER);
}

export function isInEez(lon: number, lat: number): boolean {
  return pointInRing(lon, lat, BD_EEZ);
}

const EARTH_R_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees from point 1 to point 2. */
export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Project a position forward along a bearing — used for dead reckoning. */
export function projectPosition(
  lat: number,
  lon: number,
  bearingDegrees: number,
  distanceKm: number
): { lat: number; lon: number } {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const angular = distanceKm / EARTH_R_KM;
  const br = toRad(bearingDegrees);
  const lat1 = toRad(lat);
  const lon1 = toRad(lon);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) + Math.cos(lat1) * Math.sin(angular) * Math.cos(br)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2)
    );

  return { lat: toDeg(lat2), lon: (((toDeg(lon2) + 540) % 360) - 180) };
}
