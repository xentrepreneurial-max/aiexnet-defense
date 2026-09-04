/**
 * Coarse sector naming for coordinates inside the area of interest.
 *
 * These are approximate bounding boxes used to label a detection with a
 * human-readable sector. They are labelled "approx." wherever shown so an
 * operator does not mistake them for a surveyed administrative boundary.
 */

interface Sector {
  name: string;
  minLat: number;
  maxLat: number;
  minLon: number;
  maxLon: number;
}

const SECTORS: Sector[] = [
  { name: "Rangpur Division, BD", minLat: 25.0, maxLat: 26.7, minLon: 88.0, maxLon: 89.9 },
  { name: "Rajshahi Division, BD", minLat: 23.8, maxLat: 25.3, minLon: 88.0, maxLon: 89.9 },
  { name: "Mymensingh Division, BD", minLat: 24.3, maxLat: 25.5, minLon: 89.9, maxLon: 91.3 },
  { name: "Sylhet Division, BD", minLat: 23.9, maxLat: 25.3, minLon: 90.9, maxLon: 92.5 },
  { name: "Dhaka Division, BD", minLat: 23.0, maxLat: 24.6, minLon: 89.5, maxLon: 91.0 },
  { name: "Khulna Division, BD", minLat: 21.6, maxLat: 24.2, minLon: 88.9, maxLon: 89.9 },
  { name: "Barisal Division, BD", minLat: 21.8, maxLat: 23.2, minLon: 89.9, maxLon: 90.9 },
  { name: "Chittagong Division, BD", minLat: 20.7, maxLat: 24.3, minLon: 90.9, maxLon: 92.7 },
  { name: "Cox's Bazar / Teknaf frontier, BD", minLat: 20.6, maxLat: 21.9, minLon: 91.8, maxLon: 92.6 },
  { name: "Rakhine State, Myanmar", minLat: 17.0, maxLat: 21.5, minLon: 92.2, maxLon: 94.5 },
  { name: "Chin State, Myanmar", minLat: 21.0, maxLat: 24.2, minLon: 92.5, maxLon: 94.5 },
  { name: "Sagaing Region, Myanmar", minLat: 21.5, maxLat: 26.5, minLon: 94.0, maxLon: 96.5 },
  { name: "Central Myanmar", minLat: 15.0, maxLat: 22.5, minLon: 94.5, maxLon: 98.5 },
  { name: "Mizoram, India", minLat: 21.9, maxLat: 24.5, minLon: 92.2, maxLon: 93.5 },
  { name: "Tripura, India", minLat: 22.9, maxLat: 24.6, minLon: 91.0, maxLon: 92.4 },
  { name: "Manipur, India", minLat: 23.8, maxLat: 25.7, minLon: 92.9, maxLon: 94.8 },
  { name: "Meghalaya, India", minLat: 25.0, maxLat: 26.2, minLon: 89.8, maxLon: 92.9 },
  { name: "Assam, India", minLat: 24.0, maxLat: 28.0, minLon: 89.6, maxLon: 96.1 },
  { name: "West Bengal, India", minLat: 21.5, maxLat: 27.3, minLon: 85.8, maxLon: 89.0 },
  { name: "Odisha, India", minLat: 17.7, maxLat: 22.6, minLon: 81.3, maxLon: 87.6 },
  { name: "Bay of Bengal (open water)", minLat: 5.0, maxLat: 21.5, minLon: 80.0, maxLon: 95.0 },
];

export function describeSector(lat: number, lon: number): string {
  for (const s of SECTORS) {
    if (lat >= s.minLat && lat <= s.maxLat && lon >= s.minLon && lon <= s.maxLon) {
      return s.name;
    }
  }
  return `${lat.toFixed(3)}, ${lon.toFixed(3)} (outside named sectors)`;
}

/** True when the coordinate is inside Bangladesh's approximate land envelope. */
export function isInsideBangladeshEnvelope(lat: number, lon: number): boolean {
  return lat >= 20.5 && lat <= 26.7 && lon >= 88.0 && lon <= 92.7;
}
