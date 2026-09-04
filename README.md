# AIEXNET Defense — Regional Air / Sea / Space Picture

A live situational-awareness console for Bangladesh and the Indian Ocean
region: aircraft, ships, satellites, thermal anomalies, recorded history, and
UAV mission planning on one map.

## The one rule this codebase follows

**Nothing on the map is invented.** Every contact comes from a real feed. When
a feed is unreachable or unconfigured, the layer is empty and the HUD reports
`NO LINK` / `NO KEY` with the reason. An empty map never means "quiet sky" —
the Sensor Link Status panel always tells you which it is.

There is no simulation mode, no seeded demo traffic, and no fallback dataset.

## Data sources

| Layer | Source | Key needed | Update rate |
|---|---|---|---|
| Air (ADS-B) | [adsb.fi](https://adsb.fi) → [adsb.lol](https://adsb.lol) fallback | none | full cycle every ~12 s |
| Military air | the same feeds' worldwide military endpoint | none | every other cycle |
| Space (orbits) | [CelesTrak](https://celestrak.org) element sets + SGP4 | none | TLEs refreshed every 6 h, propagated continuously |
| Archive / replay | local SQLite (`node:sqlite`) | none | snapshot every 5 s |
| Sea (AIS) | [AISStream.io](https://aisstream.io) | `AISSTREAM_API_KEY` | live WebSocket |
| Thermal (fire) | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | `NASA_FIRMS_MAP_KEY` | per satellite overpass (cached 10 min) |
| Radar (SAR) | [Copernicus Sentinel-1](https://dataspace.copernicus.eu) | `CDSE_CLIENT_ID`/`SECRET` | on demand |
| UAV telemetry | your MAVLink bridge | none | as fast as it pushes |
| Threat stream | derived from the above | — | every 6 s |

All keys are free. Copy `.env.example` to `.env.local` and fill them in.

## Coverage, and its real limits

Six core query points cover the national picture every cycle; twenty-four
extended points reach from the Gulf to Indochina, sampled a few per cycle. The
worldwide military endpoint is swept regularly and clipped to a theatre box.

**Open ADS-B is a terrestrial receiver network.** Mid-ocean has almost no
ground stations, so open-water contacts are sparse or absent no matter how
many query points are added. Closing that gap needs space-based ADS-B
(Aireon), which is a paid service. The same applies in reverse to military
traffic: aircraft on operations routinely switch their transponders off, so
what you see is what chooses to be seen.

## How positions are handled

- The server stores the **observed** position and the epoch it was observed at.
- Between polls the client **dead reckons**: it projects the last observed
  position forward along the last observed track at the last observed ground
  speed, using great-circle geometry. Extrapolated contacts are labelled as
  such in the inspector.
- Dead reckoning is **bounded**. After 60 s with no new ADS-B position (600 s
  for AIS) the projection stops and the contact fades — because at that point
  we genuinely do not know where it is.
- Satellites are never dead reckoned. The client runs SGP4 on the same element
  set the server used, so the displayed position is a real propagation.
- Contacts not heard from for 3 minutes are dropped entirely.

## Time machine

Every observed position is written to `data/archive.db`. Dead-reckoned display
positions are deliberately **never** written — replaying an interpolation as if
it were an observation would make the archive lie.

The scrubber is bounded by what the archive actually holds, so it cannot be
dragged into time that was never recorded, and a thin period replays thin.

- `GET /api/defense/archive?at=<iso|epoch>` — the picture at a past instant
- `GET /api/defense/archive/track?id=<icao24|mmsi>` — one contact's history
- `GET /api/defense/archive/stats` — bounds, row counts, recorder health

## Dark-vessel analysis

Two independent methods, because each catches what the other misses.

**AIS gap analysis** needs no extra source, only the archive. A vessel that was
under way and reporting, then stopped, is surfaced with the dead-reckoned
position it should now be at. Reappearance events show the speed a jump
implies against the speed the vessel declared. A gap is a cue to look, not
evidence of intent, and the API says so in its own payload.

**Sentinel-1 SAR** sees hulls regardless of what they broadcast. A radar target
with no AIS vessel near it is a vessel running without AIS. The detector is
cell-averaging CFAR over summed-area tables, so its guard band can be wide
enough (~240 m) that a large ship does not pollute its own background estimate
and hide itself. Verified against synthetic imagery: 3/3 recall, zero false
alarms, 0.01 px centroid error.

## UAV mission planning

Navigation and flight safety only — route geometry, range, endurance,
geofencing, and deconfliction against the live air picture. Plans export to the
QGroundControl `.plan` format, so the same file loads into QGroundControl or
Mission Planner and flies on ArduPilot or PX4.

**There is no weapons or stores handling in this codebase and none is planned.**

Deconfliction is advisory: it sees a picture seconds old and only aircraft
transmitting ADS-B. It is not a collision avoidance system.

Point a MAVLink bridge at `POST /api/defense/drone` to see live telemetry.
Minimum fields are `vehicleId`, `latitude`, `longitude`; everything else is
optional and reported as null when the vehicle does not send it.

## Aircraft classification

A track is called MILITARY only on real evidence, and the inspector shows
which evidence fired:

- the feed's own military airframe database flag (`dbFlags` bit 0)
- ICAO 24-bit address inside a national military allocation block
- ICAO type designator matching a known military airframe
- registration in a state/military series

Operator names come from the callsign's ICAO airline designator, **cross-checked
against the tail number's country of registry**. On a mismatch the traffic is
still classified but no operator is named — our table is wrong for that prefix
and asserting it would be worse than saying nothing. Anything unmatched stays
`UNKNOWN` rather than being given a plausible-looking invented identity.

## Boundaries

The ADIZ, land border and EEZ polygons are hand-digitised approximations for
display and proximity alerting. They are labelled `approx.` everywhere they
appear and must not be used as a legal or navigational reference.

## Reference data

`src/services/referenceData.ts` holds fixed installations — real, publicly
documented facilities. Range rings are nominal published envelopes for the
stated equipment class, not measured performance. Installations do not move,
so this file contains no telemetry of any kind.

## API

| Endpoint | Returns |
|---|---|
| `GET /api/defense/flights` | live ADS-B tracks + link diagnostics |
| `GET /api/defense/vessels` | live AIS vessels + link state |
| `GET /api/defense/satellites` | SGP4 positions, ground tracks, next AOI pass |
| `GET /api/defense/thermal` | FIRMS active-fire detections |
| `GET /api/defense/alerts` | alerts derived from the above, each with evidence |
| `GET /api/defense/darkvessels` | AIS gaps, reappearances, optional SAR sweep |
| `GET /api/defense/archive` | replay the picture at a past instant |
| `GET/POST /api/defense/drone` | UAV telemetry read / ingest |
| `POST /api/defense/mission` | route analysis + QGroundControl `.plan` |
| `POST /api/defense/query` | computed answers over the live picture |
| `GET /api/defense/status` | every feed's health in one place |

`/api/defense/status` is the fastest way to check whether the system is
actually receiving.

## Running

```bash
npm install
npm run dev     # http://localhost:3005
```

Production: `npm run build && npm start` (binds 0.0.0.0:3000).

The ADS-B poller, the AIS socket and the archive recorder are long-lived
in-process singletons, so deploy this on a persistent Node server — not a
per-request serverless target. Node 22+ is required for the built-in
`node:sqlite` and `WebSocket`.
