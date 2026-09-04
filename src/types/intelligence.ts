export type UserRole = 'COMMANDER' | 'SENIOR_ANALYST' | 'OPERATOR' | 'OBSERVER';

export interface UserProfile {
  id: string;
  callsign: string;
  name: string;
  role: UserRole;
  clearance: 'TOP SECRET' | 'SECRET' | 'RESTRICTED' | 'UNCLASSIFIED';
  sector: string;
}

/** Health of one intelligence feed. Surfaced in the HUD so an operator can
 *  never mistake a dead feed for a quiet sky. */
export type LinkState = 'LIVE' | 'DEGRADED' | 'OFFLINE' | 'NO_KEY';

export interface FeedStatus {
  /** Feed identifier, e.g. "AIR", "SEA", "SPACE", "THERMAL". */
  id: string;
  linkState: LinkState;
  /** Upstream actually serving the data right now. */
  source: string;
  count: number;
  /** Seconds since the feed last returned data. */
  lastUpdateAgeSec: number | null;
  message: string | null;
}

export interface FlightData {
  icao24: string;
  callsign: string;
  /** Tail number from the airframe registry, when the feed knows it. */
  registration?: string | null;
  /** ICAO type designator, e.g. "A359", "C17". */
  aircraftType?: string | null;
  /** Plain-language airframe description from the registry. */
  aircraftDesc?: string | null;
  /** Country derived from the ICAO 24-bit address allocation block. */
  origin_country: string;
  countryIso?: string;
  longitude: number;
  latitude: number;
  baro_altitude: number; // metres
  altitudeFt?: number;
  velocity: number; // m/s ground speed
  groundSpeedKts?: number;
  true_track: number; // degrees
  vertical_rate?: number; // m/s
  verticalRateFpm?: number;
  squawk?: string | null;
  on_ground: boolean;
  category: 'COMMERCIAL' | 'MILITARY' | 'CARGO' | 'UNKNOWN' | 'VIP';
  threatLevel: 'NORMAL' | 'ELEVATED' | 'HIGH';
  /** Resolved airframe model, null when the registry has no entry. */
  model?: string | null;
  /** Resolved operator, null when unknown. */
  operator?: string | null;
  /** Evidence trail for the classification, shown in the inspector. */
  classificationBasis?: string[];
  emergency?: boolean;
  signalRssi?: number | null;
  messages?: number | null;
  /** Age of the position report in seconds at the time it was received. */
  positionAgeSec?: number;
  /** Epoch ms the position was actually observed (not when we polled). */
  positionTime?: number;
  lastContact: number;
  dataSource?: string;
  /** Recent observed positions, [lon, lat]. Real history, not a prediction. */
  history?: Array<[number, number]>;
  /** Display-only: seconds since the underlying observation. */
  coastAgeSec?: number;
  /** Display-only: true when the shown position is extrapolated, not observed. */
  deadReckoned?: boolean;
}

export interface VesselData {
  mmsi: string;
  name: string;
  type: 'NAVAL' | 'CARGO' | 'TANKER' | 'FISHING' | 'COAST_GUARD' | 'SUBMARINE' | 'PASSENGER' | 'TUG' | 'OTHER';
  flag: string;
  latitude: number;
  longitude: number;
  speed: number; // knots (speed over ground)
  heading: number; // degrees (course over ground)
  trueHeading?: number | null;
  destination: string;
  status: 'UNDERWAY' | 'ANCHORED' | 'PATROL' | 'INTERCEPT' | 'MOORED' | 'AGROUND' | 'FISHING' | 'UNKNOWN';
  threatLevel: 'NORMAL' | 'SUSPICIOUS' | 'CRITICAL';
  imo?: string | null;
  callsign?: string | null;
  lengthM?: number | null;
  beamM?: number | null;
  draughtM?: number | null;
  eta?: string | null;
  /** Epoch ms of the AIS report. */
  lastReport?: number;
  dataSource?: string;
  history?: Array<[number, number]>;
  /** Display-only: seconds since the underlying AIS report. */
  coastAgeSec?: number;
  /** Display-only: true when the shown position is extrapolated, not observed. */
  deadReckoned?: boolean;
}

export interface SatelliteData {
  id: string;
  name: string;
  noradId: number;
  type: 'COMMUNICATION' | 'OPTICAL_RECON' | 'SAR_RADAR' | 'WEATHER' | 'SPACE_STATION' | 'NAVIGATION' | 'SIGINT';
  operator: string;
  latitude: number;
  longitude: number;
  altitude: number; // km
  velocity: number; // km/s
  footprintRadiusKm: number;
  orbitPath: [number, number][]; // [[lng, lat], ...]
  revisitFrequencyHours?: number;
  /** The element set itself, so the client can run SGP4 between polls
   *  instead of guessing motion. */
  tleLine1?: string;
  tleLine2?: string;
  /** TLE epoch — how fresh the orbital element set is. */
  tleEpoch?: string;
  tleAgeDays?: number;
  /** Set when the satellite is currently above the horizon for the AOI. */
  overheadAoi?: boolean;
  /** Next pass over the area of interest, epoch ms. */
  nextPassTime?: number | null;
  inclinationDeg?: number;
  periodMinutes?: number;
}

export interface DefenseBase {
  id: string;
  name: string;
  branch: 'AIR_FORCE' | 'NAVY' | 'ARMY' | 'COAST_GUARD';
  latitude: number;
  longitude: number;
  code: string;
  runwayLengthMeters?: number;
  radarRangeKm: number;
  missileDefenseRangeKm?: number;
  assets: string[];
  status: 'OPERATIONAL' | 'HIGH_ALERT' | 'STANDBY';
  /** Where the facility coordinates and asset list came from. */
  sourceNote?: string;
}

export interface ThermalAnomaly {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number; // Kelvin
  confidence: number; // 0 - 100%
  satellite: 'MODIS' | 'VIIRS' | 'VIIRS_NOAA20' | 'VIIRS_NOAA21' | 'LANDSAT';
  /** ISO timestamp of the satellite overpass that detected it. */
  detectionTime: string;
  detectionEpoch?: number;
  areaDescription: string;
  riskType: 'FOREST_FIRE' | 'INDUSTRIAL' | 'BORDER_ACTIVITY' | 'AGRICULTURAL' | 'UNCLASSIFIED';
  frp?: number; // Fire Radiative Power, MW
  scanKm?: number;
  trackKm?: number;
  dayNight?: 'D' | 'N';
  dataSource?: string;
}

export interface ThreatAlert {
  id: string;
  timestamp: string;
  /** Epoch ms the triggering observation was made. */
  epoch: number;
  level: 'DEFCON_1' | 'DEFCON_2' | 'DEFCON_3' | 'DEFCON_4' | 'DEFCON_5';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  sector: string;
  coordinates?: [number, number];
  /** The observation that produced this alert — feed name and record id. */
  evidence: {
    feed: string;
    recordId: string;
    observedAt: string;
  };
}
