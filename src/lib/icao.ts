/**
 * ICAO 24-bit address (Mode-S hex) utilities.
 *
 * Country is derived from the ICAO address allocation blocks published in
 * ICAO Annex 10 Vol III. This is real registry data, not a guess based on
 * callsign text.
 */

interface IcaoBlock {
  start: number;
  end: number;
  country: string;
  iso: string;
}

// Allocation blocks, ordered most-specific first where blocks nest.
const ICAO_BLOCKS: IcaoBlock[] = [
  { start: 0x700000, end: 0x700fff, country: "Afghanistan", iso: "AF" },
  { start: 0x501000, end: 0x5013ff, country: "Albania", iso: "AL" },
  { start: 0x0a0000, end: 0x0a7fff, country: "Algeria", iso: "DZ" },
  { start: 0x900000, end: 0x9003ff, country: "Angola", iso: "AO" },
  { start: 0xe00000, end: 0xe3ffff, country: "Argentina", iso: "AR" },
  { start: 0x600000, end: 0x6003ff, country: "Armenia", iso: "AM" },
  { start: 0x7c0000, end: 0x7fffff, country: "Australia", iso: "AU" },
  { start: 0x440000, end: 0x447fff, country: "Austria", iso: "AT" },
  { start: 0x600800, end: 0x600bff, country: "Azerbaijan", iso: "AZ" },
  { start: 0x894000, end: 0x894fff, country: "Bahrain", iso: "BH" },
  { start: 0x702000, end: 0x702fff, country: "Bangladesh", iso: "BD" },
  { start: 0x510000, end: 0x5103ff, country: "Belarus", iso: "BY" },
  { start: 0x448000, end: 0x44ffff, country: "Belgium", iso: "BE" },
  { start: 0x680000, end: 0x6803ff, country: "Bhutan", iso: "BT" },
  { start: 0xe94000, end: 0xe94fff, country: "Bolivia", iso: "BO" },
  { start: 0xe40000, end: 0xe7ffff, country: "Brazil", iso: "BR" },
  { start: 0x450000, end: 0x457fff, country: "Bulgaria", iso: "BG" },
  { start: 0x70e000, end: 0x70efff, country: "Cambodia", iso: "KH" },
  { start: 0xc00000, end: 0xc3ffff, country: "Canada", iso: "CA" },
  { start: 0xe80000, end: 0xe80fff, country: "Chile", iso: "CL" },
  { start: 0x780000, end: 0x7bffff, country: "China", iso: "CN" },
  { start: 0x0ac000, end: 0x0affff, country: "Colombia", iso: "CO" },
  { start: 0x501c00, end: 0x501fff, country: "Croatia", iso: "HR" },
  { start: 0x4c8000, end: 0x4c83ff, country: "Cyprus", iso: "CY" },
  { start: 0x498000, end: 0x49ffff, country: "Czechia", iso: "CZ" },
  { start: 0x458000, end: 0x45ffff, country: "Denmark", iso: "DK" },
  { start: 0xe84000, end: 0xe84fff, country: "Ecuador", iso: "EC" },
  { start: 0x010000, end: 0x017fff, country: "Egypt", iso: "EG" },
  { start: 0x511000, end: 0x5113ff, country: "Estonia", iso: "EE" },
  { start: 0x040000, end: 0x047fff, country: "Ethiopia", iso: "ET" },
  { start: 0x460000, end: 0x467fff, country: "Finland", iso: "FI" },
  { start: 0x380000, end: 0x3bffff, country: "France", iso: "FR" },
  { start: 0x514000, end: 0x5143ff, country: "Georgia", iso: "GE" },
  { start: 0x3c0000, end: 0x3fffff, country: "Germany", iso: "DE" },
  { start: 0x468000, end: 0x46ffff, country: "Greece", iso: "GR" },
  { start: 0x470000, end: 0x477fff, country: "Hungary", iso: "HU" },
  { start: 0x800000, end: 0x83ffff, country: "India", iso: "IN" },
  { start: 0x8a0000, end: 0x8a7fff, country: "Indonesia", iso: "ID" },
  { start: 0x730000, end: 0x737fff, country: "Iran", iso: "IR" },
  { start: 0x728000, end: 0x72ffff, country: "Iraq", iso: "IQ" },
  { start: 0x4ca000, end: 0x4cafff, country: "Ireland", iso: "IE" },
  { start: 0x738000, end: 0x73ffff, country: "Israel", iso: "IL" },
  { start: 0x300000, end: 0x33ffff, country: "Italy", iso: "IT" },
  { start: 0x840000, end: 0x87ffff, country: "Japan", iso: "JP" },
  { start: 0x740000, end: 0x747fff, country: "Jordan", iso: "JO" },
  { start: 0x683000, end: 0x6833ff, country: "Kazakhstan", iso: "KZ" },
  { start: 0x04c000, end: 0x04ffff, country: "Kenya", iso: "KE" },
  { start: 0x718000, end: 0x71ffff, country: "Korea (North)", iso: "KP" },
  { start: 0x71c000, end: 0x71ffff, country: "Korea (South)", iso: "KR" },
  { start: 0x706000, end: 0x706fff, country: "Kuwait", iso: "KW" },
  { start: 0x708000, end: 0x708fff, country: "Laos", iso: "LA" },
  { start: 0x502c00, end: 0x502fff, country: "Latvia", iso: "LV" },
  { start: 0x748000, end: 0x74ffff, country: "Lebanon", iso: "LB" },
  { start: 0x503c00, end: 0x503fff, country: "Lithuania", iso: "LT" },
  { start: 0x4d0000, end: 0x4d03ff, country: "Luxembourg", iso: "LU" },
  { start: 0x750000, end: 0x757fff, country: "Malaysia", iso: "MY" },
  { start: 0x05a000, end: 0x05a3ff, country: "Maldives", iso: "MV" },
  { start: 0x4d2000, end: 0x4d23ff, country: "Malta", iso: "MT" },
  { start: 0x0d0000, end: 0x0d7fff, country: "Mexico", iso: "MX" },
  { start: 0x682000, end: 0x6823ff, country: "Mongolia", iso: "MN" },
  { start: 0x020000, end: 0x027fff, country: "Morocco", iso: "MA" },
  { start: 0x704000, end: 0x704fff, country: "Myanmar", iso: "MM" },
  { start: 0x70a000, end: 0x70afff, country: "Nepal", iso: "NP" },
  { start: 0x480000, end: 0x487fff, country: "Netherlands", iso: "NL" },
  { start: 0xc80000, end: 0xc87fff, country: "New Zealand", iso: "NZ" },
  { start: 0x064000, end: 0x064fff, country: "Nigeria", iso: "NG" },
  { start: 0x478000, end: 0x47ffff, country: "Norway", iso: "NO" },
  { start: 0x70c000, end: 0x70cfff, country: "Oman", iso: "OM" },
  { start: 0x760000, end: 0x767fff, country: "Pakistan", iso: "PK" },
  { start: 0xe8c000, end: 0xe8cfff, country: "Paraguay", iso: "PY" },
  { start: 0xe8c400, end: 0xe8c7ff, country: "Peru", iso: "PE" },
  { start: 0x758000, end: 0x75ffff, country: "Philippines", iso: "PH" },
  { start: 0x488000, end: 0x48ffff, country: "Poland", iso: "PL" },
  { start: 0x490000, end: 0x497fff, country: "Portugal", iso: "PT" },
  { start: 0x06a000, end: 0x06a3ff, country: "Qatar", iso: "QA" },
  { start: 0x4a0000, end: 0x4a7fff, country: "Romania", iso: "RO" },
  { start: 0x100000, end: 0x1fffff, country: "Russia", iso: "RU" },
  { start: 0x710000, end: 0x717fff, country: "Saudi Arabia", iso: "SA" },
  { start: 0x76c000, end: 0x76cfff, country: "Singapore", iso: "SG" },
  { start: 0x505c00, end: 0x505fff, country: "Slovakia", iso: "SK" },
  { start: 0x506c00, end: 0x506fff, country: "Slovenia", iso: "SI" },
  { start: 0x008000, end: 0x00ffff, country: "South Africa", iso: "ZA" },
  { start: 0x340000, end: 0x37ffff, country: "Spain", iso: "ES" },
  { start: 0x770000, end: 0x777fff, country: "Sri Lanka", iso: "LK" },
  { start: 0x4a8000, end: 0x4affff, country: "Sweden", iso: "SE" },
  { start: 0x4b0000, end: 0x4b7fff, country: "Switzerland", iso: "CH" },
  { start: 0x778000, end: 0x77ffff, country: "Syria", iso: "SY" },
  { start: 0x899000, end: 0x8993ff, country: "Taiwan", iso: "TW" },
  { start: 0x880000, end: 0x887fff, country: "Thailand", iso: "TH" },
  { start: 0x0a8000, end: 0x0a8fff, country: "Tunisia", iso: "TN" },
  { start: 0x4b8000, end: 0x4bffff, country: "Turkey", iso: "TR" },
  { start: 0x508000, end: 0x5083ff, country: "Turkmenistan", iso: "TM" },
  { start: 0x068000, end: 0x068fff, country: "Uganda", iso: "UG" },
  { start: 0x508400, end: 0x5087ff, country: "Ukraine", iso: "UA" },
  { start: 0x896000, end: 0x896fff, country: "United Arab Emirates", iso: "AE" },
  { start: 0x400000, end: 0x43ffff, country: "United Kingdom", iso: "GB" },
  { start: 0xa00000, end: 0xafffff, country: "United States", iso: "US" },
  { start: 0x507c00, end: 0x507fff, country: "Uzbekistan", iso: "UZ" },
  { start: 0x888000, end: 0x88ffff, country: "Vietnam", iso: "VN" },
  { start: 0x890000, end: 0x890fff, country: "Yemen", iso: "YE" },
  { start: 0x08a000, end: 0x08afff, country: "Zimbabwe", iso: "ZW" },
];

/**
 * Hex ranges that national registries reserve for military airframes.
 * These are widely documented in the readsb / tar1090 community databases
 * and are the same ranges tar1090 uses to paint a track as military.
 */
const MILITARY_HEX_RANGES: Array<{ start: number; end: number; label: string }> = [
  { start: 0xadf7c8, end: 0xafffff, label: "US Military" },
  { start: 0xa00000, end: 0xa00000, label: "US Military" },
  { start: 0x010070, end: 0x01008f, label: "Egypt Air Force" },
  { start: 0x0a4000, end: 0x0a4fff, label: "Algeria Air Force" },
  { start: 0x33ff00, end: 0x33ffff, label: "Italy Air Force" },
  { start: 0x350000, end: 0x37ffff, label: "Spain Air Force" },
  { start: 0x3aa000, end: 0x3affff, label: "France Air Force" },
  { start: 0x3b7000, end: 0x3bffff, label: "France Air Force" },
  { start: 0x3ea000, end: 0x3ebfff, label: "Germany Air Force" },
  { start: 0x3f4000, end: 0x3f7fff, label: "Germany Air Force" },
  { start: 0x3f9000, end: 0x3fffff, label: "Germany Air Force" },
  { start: 0x400000, end: 0x40003f, label: "UK Military" },
  { start: 0x43c000, end: 0x43cfff, label: "UK Military" },
  { start: 0x447000, end: 0x447fff, label: "Austria Air Force" },
  { start: 0x44f000, end: 0x44ffff, label: "Belgium Air Force" },
  { start: 0x457000, end: 0x457fff, label: "Bulgaria Air Force" },
  { start: 0x45f400, end: 0x45f4ff, label: "Denmark Air Force" },
  { start: 0x468000, end: 0x4683ff, label: "Greece Air Force" },
  { start: 0x473c00, end: 0x473c0f, label: "Hungary Air Force" },
  { start: 0x478100, end: 0x4781ff, label: "Norway Air Force" },
  { start: 0x480000, end: 0x480fff, label: "Netherlands Air Force" },
  { start: 0x48d800, end: 0x48d87f, label: "Poland Air Force" },
  { start: 0x497c00, end: 0x497cff, label: "Portugal Air Force" },
  { start: 0x498420, end: 0x49842f, label: "Czech Air Force" },
  { start: 0x4b7000, end: 0x4b7fff, label: "Switzerland Air Force" },
  { start: 0x4b8200, end: 0x4b82ff, label: "Turkey Air Force" },
  { start: 0x506f00, end: 0x506fff, label: "Slovenia Air Force" },
  { start: 0x70c070, end: 0x70c07f, label: "Oman Air Force" },
  { start: 0x710258, end: 0x71028f, label: "Saudi Air Force" },
  { start: 0x710380, end: 0x71039f, label: "Saudi Air Force" },
  { start: 0x738a00, end: 0x738aff, label: "Israel Air Force" },
  { start: 0x7cf800, end: 0x7cfaff, label: "Australia Military" },
  { start: 0xc20000, end: 0xc3ffff, label: "Canada Military" },
  { start: 0xe40000, end: 0xe41fff, label: "Brazil Air Force" },
];

export interface IcaoIdentity {
  country: string;
  iso: string;
  militaryBlock: string | null;
}

export function identifyIcao(hex: string): IcaoIdentity {
  const clean = (hex || "").trim().toLowerCase().replace(/[^0-9a-f]/g, "");
  if (clean.length !== 6) {
    return { country: "Unknown", iso: "--", militaryBlock: null };
  }
  const addr = parseInt(clean, 16);

  let country = "Unknown";
  let iso = "--";
  let best = Number.MAX_SAFE_INTEGER;
  for (const b of ICAO_BLOCKS) {
    if (addr >= b.start && addr <= b.end) {
      const span = b.end - b.start;
      if (span < best) {
        best = span;
        country = b.country;
        iso = b.iso;
      }
    }
  }

  let militaryBlock: string | null = null;
  for (const m of MILITARY_HEX_RANGES) {
    if (addr >= m.start && addr <= m.end) {
      militaryBlock = m.label;
      break;
    }
  }

  return { country, iso, militaryBlock };
}
