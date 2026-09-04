# AIEXNET Defense — Regional Air / Sea / Space Picture

A live situational-awareness console for Bangladesh and the surrounding
region: aircraft, ships, satellites and thermal anomalies on one map.

## The one rule this codebase follows

**Nothing on the map is invented.** Every contact comes from a real feed. When
a feed is unreachable or unconfigured, the layer is empty and the HUD reports
`NO LINK` / `NO KEY` with the reason. An empty map never means "quiet sky" —
the Sensor Link Status panel always tells you which it is.

There is no simulation mode, no seeded demo traffic, and no fallback dataset.

## Data sources

| Layer | Source | Key needed | Update rate |
|---|---|---|---|
| Air (ADS-B) | [adsb.fi](https://adsb.fi) → [adsb.lol](https://adsb.lol) fallback | none | full 6-point sweep every ~6.6 s |
| Space (orbits) | [CelesTrak](https://celestrak.org) element sets + SGP4 | none | TLEs refreshed every 6 h, propagated continuously |
| Sea (AIS) | [AISStream.io](https://aisstream.io) | `AISSTREAM_API_KEY` | live WebSocket |
| Thermal (fire) | [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) | `NASA_FIRMS_MAP_KEY` | per satellite overpass (cached 10 min) |
| Threat stream | derived from the four above | — | every 6 s |

Both keys are free. Copy `.env.example` to `.env.local` and fill them in.

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

## Aircraft classification

A track is called MILITARY only on real evidence, and the inspector shows
which evidence fired:

- the feed's own military airframe database flag (`dbFlags` bit 0)
- ICAO 24-bit address inside a national military allocation block
- ICAO type designator matching a known military airframe
- registration in a state/military series

Operator names come from the callsign's ICAO airline designator. Threat level
is raised by transponder emergency states (7500 / 7600 / 7700) and by measured
kinematics. Anything unmatched is reported as `UNKNOWN` — never given a
plausible-looking invented identity.

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
| `GET /api/defense/status` | every feed's health in one place |
| `POST /api/defense/query` | computed answers over the live picture |

`/api/defense/status` is the fastest way to check whether the system is
actually receiving.

## Running

```bash
npm install
npm run dev     # http://localhost:3005
```

Production: `npm run build && npm start` (binds 0.0.0.0:3000).

The ADS-B poller and the AIS socket are long-lived in-process singletons, so
deploy this on a persistent Node server — not a per-request serverless target.
