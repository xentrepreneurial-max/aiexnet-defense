export type UserRole = 'COMMANDER' | 'SENIOR_ANALYST' | 'OPERATOR' | 'OBSERVER';

export interface UserProfile {
  id: string;
  callsign: string;
  name: string;
  role: UserRole;
  clearance: 'TOP SECRET' | 'SECRET' | 'RESTRICTED' | 'UNCLASSIFIED';
  sector: string;
}

export interface FlightData {
  icao24: string;
  callsign: string;
  origin_country: string;
  longitude: number;
  latitude: number;
  baro_altitude: number; // in meters
  velocity: number; // m/s
  true_track: number; // degrees heading
  vertical_rate?: number;
  squawk?: string;
  on_ground: boolean;
  category: 'COMMERCIAL' | 'MILITARY' | 'CARGO' | 'UNKNOWN' | 'VIP';
  threatLevel: 'NORMAL' | 'ELEVATED' | 'HIGH';
  lastContact: number;
}

export interface VesselData {
  mmsi: string;
  name: string;
  type: 'NAVAL' | 'CARGO' | 'TANKER' | 'FISHING' | 'COAST_GUARD' | 'SUBMARINE';
  flag: string;
  latitude: number;
  longitude: number;
  speed: number; // knots
  heading: number; // degrees
  destination: string;
  status: 'UNDERWAY' | 'ANCHORED' | 'PATROL' | 'INTERCEPT';
  threatLevel: 'NORMAL' | 'SUSPICIOUS' | 'CRITICAL';
}

export interface SatelliteData {
  id: string;
  name: string;
  noradId: number;
  type: 'COMMUNICATION' | 'OPTICAL_RECON' | 'SAR_RADAR' | 'WEATHER' | 'SPACE_STATION';
  operator: string;
  latitude: number;
  longitude: number;
  altitude: number; // km
  velocity: number; // km/s
  footprintRadiusKm: number;
  orbitPath: [number, number][]; // [[lng, lat], ...]
  revisitFrequencyHours?: number;
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
}

export interface ThermalAnomaly {
  id: string;
  latitude: number;
  longitude: number;
  brightness: number; // Kelvin
  confidence: number; // 0 - 100%
  satellite: 'MODIS' | 'VIIRS';
  detectionTime: string;
  areaDescription: string;
  riskType: 'FOREST_FIRE' | 'INDUSTRIAL' | 'BORDER_ACTIVITY';
}

export interface ThreatAlert {
  id: string;
  timestamp: string;
  level: 'DEFCON_1' | 'DEFCON_2' | 'DEFCON_3' | 'DEFCON_4' | 'DEFCON_5';
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  title: string;
  description: string;
  sector: string;
  coordinates?: [number, number];
}
