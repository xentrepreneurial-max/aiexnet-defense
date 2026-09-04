/**
 * Aircraft classification from real ADS-B fields only.
 *
 * Every branch here keys off something the transponder or the airframe
 * database actually reported: ICAO type designator, registration, the
 * feed's military database flag, squawk, or measured kinematics.
 * Nothing is invented, and an aircraft we cannot identify is reported
 * as UNKNOWN rather than being given a fictional identity.
 */

import { identifyIcao } from "./icao";

export type TrackCategory = "COMMERCIAL" | "MILITARY" | "CARGO" | "VIP" | "UNKNOWN";
export type ThreatLevel = "NORMAL" | "ELEVATED" | "HIGH";

/** ICAO type designators for military airframes relevant to the region. */
const MILITARY_TYPE_CODES: Record<string, string> = {
  // Fighters / strike
  F16: "General Dynamics F-16 Fighting Falcon",
  F15: "McDonnell Douglas F-15 Eagle",
  F18: "Boeing F/A-18 Hornet",
  F22: "Lockheed Martin F-22 Raptor",
  F35: "Lockheed Martin F-35 Lightning II",
  RFAL: "Dassault Rafale",
  EUFI: "Eurofighter Typhoon",
  MG29: "Mikoyan MiG-29 Fulcrum",
  MG31: "Mikoyan MiG-31 Foxhound",
  SU30: "Sukhoi Su-30 Flanker-C",
  SU35: "Sukhoi Su-35 Flanker-E",
  SU25: "Sukhoi Su-25 Frogfoot",
  J10: "Chengdu J-10",
  JF17: "PAC/CAC JF-17 Thunder",
  F7: "Chengdu F-7",
  HAWK: "BAE Hawk",
  K8: "Hongdu JL-8 / K-8",
  YK130: "Yakovlev Yak-130",
  // Maritime patrol / ASW / AEW
  P8: "Boeing P-8 Poseidon (Maritime Patrol / ASW)",
  P3: "Lockheed P-3 Orion (Maritime Patrol)",
  A50: "Beriev A-50 Mainstay (AEW&C)",
  E3TF: "Boeing E-3 Sentry (AWACS)",
  E3CF: "Boeing E-3 Sentry (AWACS)",
  E2: "Northrop Grumman E-2 Hawkeye (AEW)",
  E6: "Boeing E-6 Mercury (TACAMO)",
  E8: "Northrop Grumman E-8 JSTARS",
  RC13: "Boeing RC-135 (SIGINT)",
  E145: "Embraer ERJ-145 AEW&C",
  // Transport / tanker
  C17: "Boeing C-17 Globemaster III",
  C5M: "Lockheed C-5M Super Galaxy",
  C30J: "Lockheed C-130J Super Hercules",
  C130: "Lockheed C-130 Hercules",
  A400: "Airbus A400M Atlas",
  AN32: "Antonov An-32",
  AN12: "Antonov An-12",
  IL76: "Ilyushin Il-76 Candid",
  K35R: "Boeing KC-135 Stratotanker",
  KC30: "Airbus A330 MRTT",
  A124: "Antonov An-124 Ruslan",
  // Rotary / UAV
  H60: "Sikorsky UH-60 Black Hawk",
  MI17: "Mil Mi-17 Hip",
  MI8: "Mil Mi-8 Hip",
  AH64: "Boeing AH-64 Apache",
  CH47: "Boeing CH-47 Chinook",
  Q4: "Northrop Grumman RQ-4 Global Hawk (HALE UAV)",
  MQ9: "General Atomics MQ-9 Reaper (MALE UAV)",
  HERN: "IAI Heron (MALE UAV)",
  B2: "Bayraktar TB2 (UCAV)",
};

/** Registration prefixes that indicate a state/military operator. */
const MILITARY_REG_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /^KB\d{3}$/i, label: "Indian Air Force" },
  { re: /^K\d{4}$/i, label: "Indian Air Force" },
  { re: /^IN\d{3}$/i, label: "Indian Navy" },
  { re: /^SB\d{2}/i, label: "Indian Air Force" },
  { re: /^S3-BAF/i, label: "Bangladesh Air Force" },
  { re: /^\d{2}-\d{4}$/, label: "US Air Force" },
  { re: /^ZZ\d{3}$/i, label: "Royal Air Force" },
];

/**
 * Aircraft registration prefix → country of registry (ICAO Annex 7).
 * Used to cross-check the airline table: if a callsign says one country and
 * the tail number says another, we do not assert the operator at all.
 */
const REG_PREFIX_COUNTRY: Array<[string, string]> = [
  ["S2-", "Bangladesh"], ["VT-", "India"], ["XY-", "Myanmar"], ["XZ-", "Myanmar"],
  ["9N-", "Nepal"], ["A5-", "Bhutan"], ["4R-", "Sri Lanka"], ["8Q-", "Maldives"],
  ["AP-", "Pakistan"], ["9V-", "Singapore"], ["9M-", "Malaysia"], ["HS-", "Thailand"],
  ["VN-", "Vietnam"], ["XU-", "Cambodia"], ["RDPL", "Laos"], ["PK-", "Indonesia"],
  ["RP-", "Philippines"], ["B-", "China"], ["B-H", "Hong Kong"], ["B-M", "Macao"],
  ["JA", "Japan"], ["HL", "Korea (South)"], ["A6-", "United Arab Emirates"],
  ["A7-", "Qatar"], ["A9C", "Bahrain"], ["A4O", "Oman"], ["9K-", "Kuwait"],
  ["HZ-", "Saudi Arabia"], ["EP-", "Iran"], ["TC-", "Turkey"], ["4L-", "Georgia"],
  ["UP-", "Kazakhstan"], ["UK-", "Uzbekistan"], ["EY-", "Tajikistan"],
  ["RA-", "Russia"], ["ET-", "Ethiopia"], ["SU-", "Egypt"], ["5Y-", "Kenya"],
  ["N", "United States"], ["C-", "Canada"], ["G-", "United Kingdom"],
  ["D-", "Germany"], ["F-", "France"], ["I-", "Italy"], ["EC-", "Spain"],
  ["PH-", "Netherlands"], ["OO-", "Belgium"], ["OE-", "Austria"],
  ["HB-", "Switzerland"], ["SE-", "Sweden"], ["LN-", "Norway"], ["OY-", "Denmark"],
  ["OH-", "Finland"], ["EI-", "Ireland"], ["CS-", "Portugal"], ["SP-", "Poland"],
  ["9H-", "Malta"], ["TF-", "Iceland"], ["LX-", "Luxembourg"], ["VP-B", "Bermuda"],
  ["VQ-B", "Bermuda"], ["2-", "Guernsey"], ["M-", "Isle of Man"],
];

function countryFromRegistration(reg: string): string | null {
  const r = reg.trim().toUpperCase();
  if (!r) return null;
  // Longest prefix wins so "B-H" beats "B-".
  const sorted = [...REG_PREFIX_COUNTRY].sort((a, b) => b[0].length - a[0].length);
  for (const [prefix, country] of sorted) {
    if (r.startsWith(prefix)) return country;
  }
  return null;
}

/**
 * Airline ICAO designator → operator.
 *
 * Each entry carries the operator's country of registry so the classifier can
 * cross-check it against the tail number. Entries marked "verified" were
 * confirmed against live traffic: the callsign prefix was observed alongside a
 * registration in that country.
 */
const AIRLINE_PREFIX: Record<
  string,
  { name: string; kind: "COMMERCIAL" | "CARGO"; country: string }
> = {
  // --- Bangladesh (verified against live S2- registrations) ---
  BBC: { name: "Biman Bangladesh Airlines", kind: "COMMERCIAL", country: "Bangladesh" },
  UBG: { name: "US-Bangla Airlines", kind: "COMMERCIAL", country: "Bangladesh" },
  NOV: { name: "Novoair", kind: "COMMERCIAL", country: "Bangladesh" },
  AAB: { name: "Air Astra", kind: "COMMERCIAL", country: "Bangladesh" },

  // --- Myanmar (verified against live XY- registrations) ---
  UBA: { name: "Myanmar National Airlines", kind: "COMMERCIAL", country: "Myanmar" },
  MMA: { name: "Myanmar Airways International", kind: "COMMERCIAL", country: "Myanmar" },

  // --- India (verified against live VT- registrations) ---
  AIC: { name: "Air India", kind: "COMMERCIAL", country: "India" },
  IGO: { name: "IndiGo", kind: "COMMERCIAL", country: "India" },
  AXB: { name: "Air India Express", kind: "COMMERCIAL", country: "India" },
  AKJ: { name: "Akasa Air", kind: "COMMERCIAL", country: "India" },
  SEJ: { name: "SpiceJet", kind: "COMMERCIAL", country: "India" },

  // --- Regional neighbours ---
  RNA: { name: "Nepal Airlines", kind: "COMMERCIAL", country: "Nepal" },
  HIM: { name: "Himalaya Airlines", kind: "COMMERCIAL", country: "Nepal" },
  DRK: { name: "Drukair", kind: "COMMERCIAL", country: "Bhutan" },
  BTN: { name: "Bhutan Airlines", kind: "COMMERCIAL", country: "Bhutan" },
  ALK: { name: "SriLankan Airlines", kind: "COMMERCIAL", country: "Sri Lanka" },
  PIA: { name: "Pakistan International Airlines", kind: "COMMERCIAL", country: "Pakistan" },

  // --- Gulf ---
  UAE: { name: "Emirates", kind: "COMMERCIAL", country: "United Arab Emirates" },
  QTR: { name: "Qatar Airways", kind: "COMMERCIAL", country: "Qatar" },
  ETD: { name: "Etihad Airways", kind: "COMMERCIAL", country: "United Arab Emirates" },
  FDB: { name: "flydubai", kind: "COMMERCIAL", country: "United Arab Emirates" },
  ABY: { name: "Air Arabia", kind: "COMMERCIAL", country: "United Arab Emirates" },
  SVA: { name: "Saudia", kind: "COMMERCIAL", country: "Saudi Arabia" },
  RXI: { name: "Riyadh Air", kind: "COMMERCIAL", country: "Saudi Arabia" },
  KAC: { name: "Kuwait Airways", kind: "COMMERCIAL", country: "Kuwait" },
  OMA: { name: "Oman Air", kind: "COMMERCIAL", country: "Oman" },
  GFA: { name: "Gulf Air", kind: "COMMERCIAL", country: "Bahrain" },

  // --- East and Southeast Asia ---
  SIA: { name: "Singapore Airlines", kind: "COMMERCIAL", country: "Singapore" },
  MAS: { name: "Malaysia Airlines", kind: "COMMERCIAL", country: "Malaysia" },
  AXM: { name: "AirAsia", kind: "COMMERCIAL", country: "Malaysia" },
  THA: { name: "Thai Airways", kind: "COMMERCIAL", country: "Thailand" },
  HVN: { name: "Vietnam Airlines", kind: "COMMERCIAL", country: "Vietnam" },
  CPA: { name: "Cathay Pacific", kind: "COMMERCIAL", country: "Hong Kong" },
  CES: { name: "China Eastern", kind: "COMMERCIAL", country: "China" },
  CSN: { name: "China Southern", kind: "COMMERCIAL", country: "China" },
  CCA: { name: "Air China", kind: "COMMERCIAL", country: "China" },
  CBJ: { name: "Capital Airlines", kind: "COMMERCIAL", country: "China" },
  RBA: { name: "Royal Brunei Airlines", kind: "COMMERCIAL", country: "Brunei" },

  // --- Long haul ---
  THY: { name: "Turkish Airlines", kind: "COMMERCIAL", country: "Turkey" },
  AFL: { name: "Aeroflot", kind: "COMMERCIAL", country: "Russia" },
  FIN: { name: "Finnair", kind: "COMMERCIAL", country: "Finland" },
  ETH: { name: "Ethiopian Airlines", kind: "COMMERCIAL", country: "Ethiopia" },
  MSR: { name: "EgyptAir", kind: "COMMERCIAL", country: "Egypt" },
  BAW: { name: "British Airways", kind: "COMMERCIAL", country: "United Kingdom" },
  DLH: { name: "Lufthansa", kind: "COMMERCIAL", country: "Germany" },
  KLM: { name: "KLM", kind: "COMMERCIAL", country: "Netherlands" },
  AFR: { name: "Air France", kind: "COMMERCIAL", country: "France" },

  // --- Cargo ---
  FDX: { name: "FedEx Express", kind: "CARGO", country: "United States" },
  UPS: { name: "UPS Airlines", kind: "CARGO", country: "United States" },
  CLX: { name: "Cargolux", kind: "CARGO", country: "Luxembourg" },
  GTI: { name: "Atlas Air", kind: "CARGO", country: "United States" },
  CKS: { name: "Kalitta Air", kind: "CARGO", country: "United States" },
  BOX: { name: "AeroLogic", kind: "CARGO", country: "Germany" },
  DHK: { name: "DHL Air", kind: "CARGO", country: "United Kingdom" },
  ABW: { name: "AirBridgeCargo", kind: "CARGO", country: "Russia" },
  MSX: { name: "MASkargo", kind: "CARGO", country: "Malaysia" },
};

export interface Classification {
  category: TrackCategory;
  threatLevel: ThreatLevel;
  /** Human-readable airframe, taken from the feed's own type data. */
  model: string | null;
  /** Operator when it can be resolved from the callsign registry. */
  operator: string | null;
  /** Why this track was classified as it was — shown in the inspector. */
  basis: string[];
  emergency: boolean;
}

export interface ClassifyInput {
  hex: string;
  callsign: string;
  typeCode?: string | null;
  typeDesc?: string | null;
  registration?: string | null;
  /** readsb dbFlags bit 0 = airframe present in the military database. */
  dbFlags?: number | null;
  squawk?: string | null;
  emergencyField?: string | null;
  altitudeM: number;
  velocityMs: number;
  verticalRateMs: number;
  onGround: boolean;
}

const EMERGENCY_SQUAWKS: Record<string, string> = {
  "7500": "UNLAWFUL INTERFERENCE (HIJACK)",
  "7600": "RADIO FAILURE",
  "7700": "GENERAL EMERGENCY",
};

export function classifyTrack(input: ClassifyInput): Classification {
  const basis: string[] = [];
  const callsign = (input.callsign || "").trim().toUpperCase();
  const typeCode = (input.typeCode || "").trim().toUpperCase();
  const reg = (input.registration || "").trim().toUpperCase();
  const squawk = (input.squawk || "").trim();

  let category: TrackCategory = "UNKNOWN";
  let threatLevel: ThreatLevel = "NORMAL";
  let model: string | null = input.typeDesc || null;
  let operator: string | null = null;
  let emergency = false;

  // 1. Feed's own military airframe database flag (readsb dbFlags bit 0).
  const flaggedMilitary = typeof input.dbFlags === "number" && (input.dbFlags & 1) === 1;
  if (flaggedMilitary) {
    category = "MILITARY";
    basis.push("Airframe present in military registry (dbFlags)");
  }

  // 2. ICAO address inside a national military allocation block.
  const identity = identifyIcao(input.hex);
  if (identity.militaryBlock) {
    category = "MILITARY";
    basis.push(`ICAO hex in ${identity.militaryBlock} block`);
  }

  // 3. ICAO type designator matches a known military airframe.
  if (typeCode && MILITARY_TYPE_CODES[typeCode]) {
    category = "MILITARY";
    model = MILITARY_TYPE_CODES[typeCode];
    basis.push(`ICAO type designator ${typeCode}`);
  }

  // 4. Registration in a state/military series.
  if (reg) {
    for (const p of MILITARY_REG_PATTERNS) {
      if (p.re.test(reg)) {
        category = "MILITARY";
        operator = p.label;
        basis.push(`Registration ${reg} in ${p.label} series`);
        break;
      }
    }
  }

  // 5. Airline registry lookup from the callsign's ICAO designator, then
  //    cross-checked against the country of registry on the tail number. A
  //    disagreement means our table is wrong for this prefix, so we classify
  //    the traffic but decline to name an operator rather than assert a
  //    country the aircraft is demonstrably not registered in.
  if (category !== "MILITARY" && callsign.length >= 3) {
    const prefix = callsign.slice(0, 3);
    const airline = AIRLINE_PREFIX[prefix];
    if (airline) {
      category = airline.kind;
      const regCountry = countryFromRegistration(reg);
      if (regCountry && regCountry !== airline.country) {
        basis.push(
          `Callsign ${prefix} maps to ${airline.name} (${airline.country}) but tail ${reg} is registered in ${regCountry} — operator not asserted`
        );
      } else {
        operator = airline.name;
        basis.push(
          `Callsign prefix ${prefix} = ${airline.name}${
            regCountry ? `, tail ${reg} confirms ${regCountry}` : ""
          }`
        );
      }
    }
  }

  // 6. Emergency / special-purpose squawk reported by the transponder.
  if (EMERGENCY_SQUAWKS[squawk]) {
    emergency = true;
    threatLevel = "HIGH";
    basis.push(`Squawk ${squawk}: ${EMERGENCY_SQUAWKS[squawk]}`);
  }
  if (input.emergencyField && input.emergencyField !== "none") {
    emergency = true;
    threatLevel = "HIGH";
    basis.push(`Transponder emergency state: ${input.emergencyField}`);
  }

  // 7. Kinematic profile — only raises threat, never invents an identity.
  const speedKts = input.velocityMs * 1.94384;
  const altFt = input.altitudeM * 3.28084;
  if (!input.onGround) {
    if (speedKts > 600 && altFt > 30000) {
      if (threatLevel === "NORMAL") threatLevel = "ELEVATED";
      basis.push(`Fast mover: ${Math.round(speedKts)} kts at ${Math.round(altFt)} ft`);
    }
    if (Math.abs(input.verticalRateMs) > 25) {
      if (threatLevel === "NORMAL") threatLevel = "ELEVATED";
      basis.push(`High vertical rate: ${Math.round(input.verticalRateMs * 196.85)} ft/min`);
    }
  }

  // 8. Military tracks default to ELEVATED unless already higher.
  if (category === "MILITARY" && threatLevel === "NORMAL") {
    threatLevel = "ELEVATED";
  }

  // 9. Still unidentified: a real ADS-B contact with no registry match.
  if (category === "UNKNOWN") {
    if (!callsign || callsign === "UNID") {
      basis.push("No callsign transmitted");
    } else {
      basis.push(`Callsign ${callsign} not in operator registry`);
    }
  }

  if (!model && typeCode) model = typeCode;

  return { category, threatLevel, model, operator, basis, emergency };
}
