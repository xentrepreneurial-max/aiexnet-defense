"use client";

import React, { useEffect, useRef, useState } from "react";
import * as satellite from "satellite.js";
import { projectPosition } from "@/lib/airspace";

/**
 * How long a contact may be dead reckoned before we stop projecting it.
 * ADS-B updates roughly every second in coverage, so a minute of silence
 * means we genuinely do not know where the aircraft is any more.
 */
const COAST_LIMIT_SEC = 60;
/** AIS reports are far sparser offshore, so vessels may coast longer. */
const VESSEL_COAST_LIMIT_SEC = 600;
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { 
  DefenseBase, 
  FlightData, 
  SatelliteData, 
  ThermalAnomaly, 
  VesselData 
} from "@/types/intelligence";
import { LayerState } from "../hud/LayerControlPanel";
import { SelectedTarget } from "../hud/TargetInspectorModal";
import { Globe, Map as MapIcon, Satellite as SatIcon, Moon, Crosshair, Compass, Eye, ShieldAlert } from "lucide-react";

export type MapStyleMode = "GOOGLE_SAT_HD" | "ESRI_SAT_4K" | "HYBRID_ROADS" | "STREETS_TOPO" | "TACTICAL_DARK";

export interface MissionOverlay {
  waypoints: Array<{
    latitude: number;
    longitude: number;
    altitudeM: number;
    action: string;
    label?: string;
  }>;
  /** Geofence ring as [lon, lat] pairs. */
  geofenceRing: Array<[number, number]> | null;
  /** Conflicting live contacts, so the operator sees them on the route. */
  conflicts: Array<{ latitude: number; longitude: number; severity: string; callsign: string }>;
}

interface TacticalMapProps {
  flights: FlightData[];
  vessels: VesselData[];
  satellites: SatelliteData[];
  defenseBases: DefenseBase[];
  thermalAnomalies: ThermalAnomaly[];
  drones?: DroneMarker[];
  mission?: MissionOverlay | null;
  /** Set while the operator is placing waypoints. */
  planningMode?: boolean;
  onMapClick?: (lngLat: { lng: number; lat: number }) => void;
  /** Current view bounds, so area-based sweeps can target what is on screen. */
  onViewportChange?: (bbox: [number, number, number, number]) => void;
  layers: LayerState;
  onSelectTarget: (target: SelectedTarget) => void;
  flyToLocation: { lng: number; lat: number; zoom: number; pitch?: number } | null;
}

export interface DroneMarker {
  vehicleId: string;
  name: string;
  latitude: number;
  longitude: number;
  headingDeg: number;
  altitudeRelM: number;
  groundSpeedMs: number;
  batteryPercent: number | null;
  flightMode: string | null;
  linkState: "LIVE" | "STALE" | "LOST";
  history?: Array<[number, number]>;
}

export const TacticalMap: React.FC<TacticalMapProps> = ({
  flights: initialFlights,
  vessels: initialVessels,
  satellites: initialSatellites,
  defenseBases,
  thermalAnomalies,
  drones = [],
  mission = null,
  planningMode = false,
  onMapClick,
  onViewportChange,
  layers,
  onSelectTarget,
  flyToLocation,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: maplibregl.Marker }>({});

  const [mapStyleMode, setMapStyleMode] = useState<MapStyleMode>("GOOGLE_SAT_HD");

  // Camera Live Telemetry State
  const [cameraTelemetry, setCameraTelemetry] = useState({
    lng: 90.3563,
    lat: 23.6850,
    zoom: 6.5,
    altitudeMeters: 450000,
    pitch: 40,
    bearing: -4,
    sector: "BANGLADESH NATIONAL AIRSPACE",
  });

  /**
   * Display state.
   *
   * Between server polls, contacts are DEAD RECKONED: the last observed
   * position is projected forward along the last observed course at the last
   * observed ground speed, using real great-circle geometry. That is what a
   * radar display does, and it is honest as long as it is bounded — so an
   * extrapolated track is marked, and once the underlying observation ages
   * past COAST_LIMIT_SEC we stop projecting and show the contact as stale
   * rather than inventing continued motion.
   *
   * Satellites are not dead reckoned at all: the client runs SGP4 on the same
   * element set the server used, so the displayed position is a real
   * propagation at the current instant.
   */
  const [liveFlights, setLiveFlights] = useState<FlightData[]>(initialFlights);
  const [liveVessels, setLiveVessels] = useState<VesselData[]>(initialVessels);
  const [liveSatellites, setLiveSatellites] = useState<SatelliteData[]>(initialSatellites);

  // Last data actually received from the server, never mutated by animation.
  const observedFlights = useRef<FlightData[]>(initialFlights);
  const observedVessels = useRef<VesselData[]>(initialVessels);
  const observedSats = useRef<SatelliteData[]>(initialSatellites);
  const satrecCache = useRef<Record<string, satellite.SatRec>>({});
  const thermalRef = useRef<ThermalAnomaly[]>(thermalAnomalies);
  const onSelectTargetRef = useRef(onSelectTarget);
  const onMapClickRef = useRef(onMapClick);

  const onViewportChangeRef = useRef(onViewportChange);
  const planningModeRef = useRef(planningMode);

  useEffect(() => {
    planningModeRef.current = planningMode;
  }, [planningMode]);

  /**
   * While placing waypoints, a click on a contact should drop a point rather
   * than open its inspector — otherwise every click near traffic hijacks the
   * planning gesture.
   */
  const selectTarget = (target: SelectedTarget) => {
    if (planningModeRef.current) return;
    onSelectTargetRef.current(target);
  };

  useEffect(() => {
    onMapClickRef.current = onMapClick;
  }, [onMapClick]);

  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  useEffect(() => {
    thermalRef.current = thermalAnomalies;
  }, [thermalAnomalies]);

  useEffect(() => {
    onSelectTargetRef.current = onSelectTarget;
  }, [onSelectTarget]);

  useEffect(() => {
    observedFlights.current = initialFlights;
    setLiveFlights(initialFlights);
  }, [initialFlights]);

  useEffect(() => {
    observedVessels.current = initialVessels;
    setLiveVessels(initialVessels);
  }, [initialVessels]);

  useEffect(() => {
    observedSats.current = initialSatellites;
    setLiveSatellites(initialSatellites);
  }, [initialSatellites]);

  useEffect(() => {
    let animationFrameId: number;
    let lastRender = 0;

    const render = (nowMs: number) => {
      // 10 Hz is smooth to the eye and leaves the main thread free for the map.
      if (nowMs - lastRender > 100) {
        lastRender = nowMs;
        const now = Date.now();

        setLiveFlights(
          observedFlights.current.map((f) => {
            const observedAt = f.positionTime ?? f.lastContact ?? now;
            const ageSec = (now - observedAt) / 1000;

            if (f.on_ground || ageSec <= 0 || ageSec > COAST_LIMIT_SEC || f.velocity <= 0) {
              return { ...f, coastAgeSec: Math.max(0, ageSec), deadReckoned: false };
            }

            const distanceKm = (f.velocity * ageSec) / 1000;
            const p = projectPosition(f.latitude, f.longitude, f.true_track, distanceKm);
            return {
              ...f,
              latitude: p.lat,
              longitude: p.lon,
              coastAgeSec: ageSec,
              deadReckoned: true,
            };
          })
        );

        setLiveVessels(
          observedVessels.current.map((v) => {
            const observedAt = v.lastReport ?? now;
            const ageSec = (now - observedAt) / 1000;

            if (ageSec <= 0 || ageSec > VESSEL_COAST_LIMIT_SEC || v.speed <= 0.2) {
              return { ...v, coastAgeSec: Math.max(0, ageSec), deadReckoned: false };
            }

            // Speed over ground is in knots: 1 kt = 1.852 km/h.
            const distanceKm = (v.speed * 1.852 * ageSec) / 3600;
            const p = projectPosition(v.latitude, v.longitude, v.heading, distanceKm);
            return {
              ...v,
              latitude: p.lat,
              longitude: p.lon,
              coastAgeSec: ageSec,
              deadReckoned: true,
            };
          })
        );

        setLiveSatellites(
          observedSats.current.map((s) => {
            if (!s.tleLine1 || !s.tleLine2) return s;
            try {
              let rec = satrecCache.current[s.id];
              if (!rec) {
                rec = satellite.twoline2satrec(s.tleLine1, s.tleLine2);
                satrecCache.current[s.id] = rec;
              }
              const when = new Date(now);
              const pv = satellite.propagate(rec, when);
              const posEci = pv?.position;
              if (!posEci || typeof posEci === "boolean") return s;
              const gmst = satellite.gstime(when);
              const gd = satellite.eciToGeodetic(posEci, gmst);
              return {
                ...s,
                latitude: satellite.degreesLat(gd.latitude),
                longitude: satellite.degreesLong(gd.longitude),
                altitude: Math.round(gd.height),
              };
            } catch {
              return s;
            }
          })
        );
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Map Tile Style Definitions with seamless Overzooming (No white tiles!)
  const getStyleForMode = (mode: MapStyleMode): maplibregl.StyleSpecification => {
    if (mode === "GOOGLE_SAT_HD") {
      return {
        version: 8,
        sources: {
          "google-sat": {
            type: "raster",
            tiles: [
              "https://mt0.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
              "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
              "https://mt2.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
              "https://mt3.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
            ],
            tileSize: 256,
            maxzoom: 20,
            attribution: "Google Satellite HD, Sub-Meter Ground Recon",
          },
        },
        layers: [
          {
            id: "google-sat-layer",
            type: "raster",
            source: "google-sat",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };
    }

    if (mode === "HYBRID_ROADS") {
      return {
        version: 8,
        sources: {
          "google-hybrid": {
            type: "raster",
            tiles: [
              "https://mt0.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
              "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
              "https://mt2.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
              "https://mt3.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
            ],
            tileSize: 256,
            maxzoom: 20,
            attribution: "Google Hybrid (Satellite + Roads & Buildings)",
          },
        },
        layers: [
          {
            id: "hybrid-layer",
            type: "raster",
            source: "google-hybrid",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };
    }

    if (mode === "ESRI_SAT_4K") {
      return {
        version: 8,
        sources: {
          "esri-satellite": {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            maxzoom: 18,
            attribution: "ESRI World Imagery",
          },
        },
        layers: [
          {
            id: "satellite-layer",
            type: "raster",
            source: "esri-satellite",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };
    }

    if (mode === "STREETS_TOPO") {
      return {
        version: 8,
        sources: {
          "osm-tiles": {
            type: "raster",
            tiles: [
              "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            maxzoom: 19,
            attribution: "© OpenStreetMap contributors",
          },
        },
        layers: [
          {
            id: "osm-layer",
            type: "raster",
            source: "osm-tiles",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };
    }

    // TACTICAL DARK (Clean military dark)
    return {
      version: 8,
      sources: {
        "esri-dark": {
          type: "raster",
          tiles: [
            "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
          ],
          tileSize: 256,
          maxzoom: 18,
          attribution: "ESRI Dark Canvas",
        },
      },
      layers: [
        {
          id: "dark-layer",
          type: "raster",
          source: "esri-dark",
          minzoom: 0,
          maxzoom: 22,
        },
      ],
    };
  };

  const createGeoJSONCircle = (center: [number, number], radiusInKm: number, points: number = 64) => {
    const coords: [number, number][] = [];
    const distanceX = radiusInKm / (111.32 * Math.cos((center[1] * Math.PI) / 180));
    const distanceY = radiusInKm / 110.574;

    for (let i = 0; i < points; i++) {
      const theta = (i / points) * (2 * Math.PI);
      const x = distanceX * Math.cos(theta);
      const y = distanceY * Math.sin(theta);
      coords.push([center[0] + x, center[1] + y]);
    }
    coords.push(coords[0]);
    return coords;
  };

  const setupTacticalGeoJSONLayers = (map: maplibregl.Map) => {
    // 1. Bangladesh Sovereign National Border (High-Contrast Glowing Boundary)
    const sovereignBdBorder = [
      [88.02, 26.63], [88.55, 26.40], [88.90, 26.30], [89.70, 26.10],
      [89.85, 25.50], [90.50, 25.18], [91.80, 25.15], [92.40, 25.05],
      [92.50, 24.80], [92.20, 24.20], [92.35, 23.80], [92.65, 23.70],
      [92.40, 22.80], [92.60, 22.10], [92.40, 21.30], [92.30, 20.80],
      [92.15, 20.55],
      [91.95, 21.45], [91.40, 22.20], [90.50, 21.90], [89.50, 21.70],
      [89.15, 21.65], [88.90, 22.50], [88.80, 23.30], [88.60, 24.20],
      [88.20, 24.80], [88.05, 25.20], [88.35, 25.80], [88.02, 26.63]
    ];

    if (!map.getSource("bd-sovereign-border")) {
      map.addSource("bd-sovereign-border", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: "BANGLADESH SOVEREIGN BORDER" },
          geometry: { type: "Polygon", coordinates: [sovereignBdBorder] },
        },
      });

      map.addLayer({
        id: "bd-border-glow",
        type: "line",
        source: "bd-sovereign-border",
        paint: {
          "line-color": "#00ff88",
          "line-width": 3.5,
          "line-opacity": 0.85,
        },
      });
    }

    // 2. Bangladesh ADIZ
    const adizCoords = [
      [87.5, 26.8],
      [89.0, 27.2],
      [92.8, 26.0],
      [93.2, 24.2],
      [93.0, 21.0],
      [92.5, 20.2],
      [89.5, 19.5],
      [87.5, 20.5],
      [87.5, 26.8],
    ];

    if (!map.getSource("adiz-boundary")) {
      map.addSource("adiz-boundary", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: "BD ADIZ" },
          geometry: { type: "Polygon", coordinates: [adizCoords] },
        },
      });

      map.addLayer({
        id: "adiz-layer-fill",
        type: "fill",
        source: "adiz-boundary",
        paint: {
          "fill-color": "#8b5cf6",
          "fill-opacity": 0.08,
        },
      });

      map.addLayer({
        id: "adiz-layer-line",
        type: "line",
        source: "adiz-boundary",
        paint: {
          "line-color": "#c084fc",
          "line-width": 2.5,
          "line-dasharray": [4, 2],
        },
      });
    }

    // 3. Maritime EEZ
    const eezCoords = [
      [89.15, 21.65],
      [89.10, 19.20],
      [91.10, 17.50],
      [92.40, 19.80],
      [92.35, 20.80],
      [89.15, 21.65],
    ];

    if (!map.getSource("eez-boundary")) {
      map.addSource("eez-boundary", {
        type: "geojson",
        data: {
          type: "Feature",
          properties: { name: "BD Maritime EEZ" },
          geometry: { type: "Polygon", coordinates: [eezCoords] },
        },
      });

      map.addLayer({
        id: "eez-layer-fill",
        type: "fill",
        source: "eez-boundary",
        paint: {
          "fill-color": "#0284c7",
          "fill-opacity": 0.12,
        },
      });

      map.addLayer({
        id: "eez-layer-line",
        type: "line",
        source: "eez-boundary",
        paint: {
          "line-color": "#38bdf8",
          "line-width": 2,
          "line-dasharray": [3, 2],
        },
      });
    }

    // 4. Observed track history (trails). These are positions actually
    //    reported by the contact — not a predicted or smoothed path.
    if (!map.getSource("track-trails")) {
      map.addSource("track-trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "track-trails-line",
        type: "line",
        source: "track-trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": [
            "match",
            ["get", "kind"],
            "MILITARY", "#fb7185",
            "CARGO", "#fbbf24",
            "UNKNOWN", "#94a3b8",
            "VESSEL", "#34d399",
            "#22d3ee",
          ],
          "line-width": 1.6,
          "line-opacity": 0.55,
        },
      });
    }

    // 5. Thermal anomalies. FIRMS can return thousands of detections in the
    //    burning season, so these are drawn as a GPU layer sized by Fire
    //    Radiative Power rather than as DOM markers.
    if (!map.getSource("thermal-points")) {
      map.addSource("thermal-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "thermal-points-glow",
        type: "circle",
        source: "thermal-points",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "frp"],
            0, 5, 25, 9, 100, 15, 400, 24,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["get", "frp"],
            0, "#fbbf24", 25, "#fb923c", 100, "#ef4444", 400, "#fca5a5",
          ],
          "circle-opacity": 0.28,
          "circle-blur": 0.8,
        },
      });

      map.addLayer({
        id: "thermal-points-core",
        type: "circle",
        source: "thermal-points",
        paint: {
          "circle-radius": [
            "interpolate", ["linear"], ["get", "frp"],
            0, 2.2, 25, 3.4, 100, 5, 400, 7,
          ],
          "circle-color": [
            "interpolate", ["linear"], ["get", "frp"],
            0, "#fde68a", 25, "#fb923c", 100, "#dc2626", 400, "#fecaca",
          ],
          "circle-stroke-width": 0.6,
          "circle-stroke-color": "#7f1d1d",
        },
      });
    }

    // 6. Maritime AIS contacts. Busy shipping lanes routinely carry thousands
    //    of vessels, so these are also a GPU layer.
    if (!map.getSource("vessel-points")) {
      map.addSource("vessel-points", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });

      map.addLayer({
        id: "vessel-points-core",
        type: "circle",
        source: "vessel-points",
        paint: {
          "circle-radius": [
            "match", ["get", "kind"],
            "NAVAL", 6, "COAST_GUARD", 5.5, "SUBMARINE", 6,
            "TANKER", 4.5, "CARGO", 4.5, 3.4,
          ],
          "circle-color": [
            "match", ["get", "kind"],
            "NAVAL", "#f43f5e",
            "COAST_GUARD", "#f59e0b",
            "SUBMARINE", "#a855f7",
            "TANKER", "#38bdf8",
            "CARGO", "#34d399",
            "FISHING", "#94a3b8",
            "#64748b",
          ],
          "circle-stroke-width": 1,
          "circle-stroke-color": "#022c22",
          "circle-opacity": 0.92,
        },
      });

      map.addLayer({
        id: "vessel-points-heading",
        type: "symbol",
        source: "vessel-points",
        layout: {
          "icon-image": "",
          "text-field": "▲",
          "text-size": 11,
          "text-rotate": ["get", "cog"],
          "text-rotation-alignment": "map",
          "text-allow-overlap": true,
          "text-offset": [0, 0],
        },
        paint: {
          "text-color": "#e2e8f0",
          "text-opacity": 0.8,
        },
      });
    }

    // 7. Mission overlay: geofence ring, planned route, drone trails.
    if (!map.getSource("mission-geofence")) {
      map.addSource("mission-geofence", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "mission-geofence-fill",
        type: "fill",
        source: "mission-geofence",
        paint: { "fill-color": "#f59e0b", "fill-opacity": 0.05 },
      });
      map.addLayer({
        id: "mission-geofence-line",
        type: "line",
        source: "mission-geofence",
        paint: {
          "line-color": "#fbbf24",
          "line-width": 2,
          "line-dasharray": [6, 3],
          "line-opacity": 0.75,
        },
      });
    }

    if (!map.getSource("mission-route")) {
      map.addSource("mission-route", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "mission-route-casing",
        type: "line",
        source: "mission-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#0f172a", "line-width": 6, "line-opacity": 0.8 },
      });
      map.addLayer({
        id: "mission-route-line",
        type: "line",
        source: "mission-route",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#22d3ee", "line-width": 2.5 },
      });
    }

    if (!map.getSource("drone-trails")) {
      map.addSource("drone-trails", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "drone-trails-line",
        type: "line",
        source: "drone-trails",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#a78bfa", "line-width": 2, "line-opacity": 0.7 },
      });
    }

    // 8. Radar & SAM Ranges
    const radarFeatures = defenseBases.map((base) => ({
      type: "Feature" as const,
      properties: { name: base.name, type: "RADAR", range: base.radarRangeKm },
      geometry: {
        type: "Polygon" as const,
        coordinates: [createGeoJSONCircle([base.longitude, base.latitude], base.radarRangeKm)],
      },
    }));

    const samFeatures = defenseBases
      .filter((b) => b.missileDefenseRangeKm)
      .map((base) => ({
        type: "Feature" as const,
        properties: { name: base.name, type: "SAM", range: base.missileDefenseRangeKm },
        geometry: {
          type: "Polygon" as const,
          coordinates: [createGeoJSONCircle([base.longitude, base.latitude], base.missileDefenseRangeKm!)],
        },
      }));

    if (!map.getSource("defense-ranges")) {
      map.addSource("defense-ranges", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [...radarFeatures, ...samFeatures],
        },
      });

      map.addLayer({
        id: "radar-rings-line",
        type: "line",
        source: "defense-ranges",
        filter: ["==", "type", "RADAR"],
        paint: {
          "line-color": "#00ff88",
          "line-width": 1.5,
          "line-opacity": 0.8,
        },
      });

      map.addLayer({
        id: "sam-rings-line",
        type: "line",
        source: "defense-ranges",
        filter: ["==", "type", "SAM"],
        paint: {
          "line-color": "#ff2a55",
          "line-width": 1.8,
          "line-dasharray": [2, 2],
          "line-opacity": 0.85,
        },
      });
    }
  };

  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: getStyleForMode(mapStyleMode),
      center: [90.3563, 23.6850],
      zoom: 6.8,
      pitch: 35,
      bearing: -4,
      maxZoom: 21,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    /** GPU layers have no DOM element, so selection is bound to the layer. */
    const bindLayerInteractions = () => {
      const bind = (
        layerId: string,
        resolve: (props: Record<string, any>) => void
      ) => {
        map.on("click", layerId, (e) => {
          const feature = e.features?.[0];
          if (feature?.properties) resolve(feature.properties as Record<string, any>);
        });
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      };

      bind("vessel-points-core", (props) => {
        if (planningModeRef.current) return;
        const v = observedVessels.current.find((x) => x.mmsi === props.mmsi);
        if (v) onSelectTargetRef.current({ type: "VESSEL", data: v });
      });

      bind("thermal-points-core", (props) => {
        if (planningModeRef.current) return;
        const th = thermalRef.current.find((x) => x.id === props.id);
        if (th) onSelectTargetRef.current({ type: "THERMAL", data: th });
      });
    };

    map.on("load", () => {
      setupTacticalGeoJSONLayers(map);
      bindLayerInteractions();
    });

    map.on("click", (e) => {
      // Only the empty map surface adds a waypoint; clicking a contact should
      // still open the inspector rather than dropping a point on top of it.
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["vessel-points-core", "thermal-points-core"].filter((id) => map.getLayer(id)),
      });
      if (hits.length > 0) return;
      onMapClickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat });
    });

    /**
     * Progressive label detail. Full labels only once the operator is zoomed
     * in enough for them to be readable; wide views keep the symbols.
     */
    const applyDeclutter = () => {
      const container = map.getContainer();
      const z = map.getZoom();
      container.classList.remove("declutter-2", "declutter-3");
      if (z < 6.0) container.classList.add("declutter-3");
      else if (z < 7.5) container.classList.add("declutter-2");
    };
    map.on("zoom", applyDeclutter);
    map.on("load", applyDeclutter);

    map.on("move", () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      const pitch = map.getPitch();
      const bearing = map.getBearing();

      const altitudeMeters = Math.round(40000000 / Math.pow(2, zoom));

      let sectorName = "BANGLADESH NATIONAL AIRSPACE";
      if (center.lat < 21.8 && center.lng > 91.0) sectorName = "BAY OF BENGAL / SE MARITIME SECTOR";
      else if (center.lat > 24.5 && center.lng > 91.0) sectorName = "SYLHET / NE BORDER SECTOR";
      else if (center.lat > 24.5 && center.lng < 89.5) sectorName = "RANGPUR / NORTHERN SECTOR";
      else if (center.lat < 23.0 && center.lng < 90.0) sectorName = "KHULNA / MONGLA COASTAL SECTOR";
      else if (center.lat >= 23.0 && center.lat <= 24.5) sectorName = "DHAKA CENTRAL DEFENSE CORRIDOR";

      const b = map.getBounds();
      onViewportChangeRef.current?.([
        b.getWest(),
        b.getSouth(),
        b.getEast(),
        b.getNorth(),
      ]);

      setCameraTelemetry({
        lng: center.lng,
        lat: center.lat,
        zoom: Math.round(zoom * 10) / 10,
        altitudeMeters,
        pitch: Math.round(pitch),
        bearing: Math.round(((bearing % 360) + 360) % 360),
        sector: sectorName,
      });
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(getStyleForMode(mapStyleMode));
    map.once("style.load", () => {
      setupTacticalGeoJSONLayers(map);
    });
  }, [mapStyleMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    if (map.getLayer("adiz-layer-fill")) {
      map.setLayoutProperty("adiz-layer-fill", "visibility", layers.showADIZ ? "visible" : "none");
      map.setLayoutProperty("adiz-layer-line", "visibility", layers.showADIZ ? "visible" : "none");
    }
    if (map.getLayer("eez-layer-fill")) {
      map.setLayoutProperty("eez-layer-fill", "visibility", layers.showEEZ ? "visible" : "none");
      map.setLayoutProperty("eez-layer-line", "visibility", layers.showEEZ ? "visible" : "none");
    }
    if (map.getLayer("radar-rings-line")) {
      map.setLayoutProperty("radar-rings-line", "visibility", layers.showRadarRings ? "visible" : "none");
    }
    if (map.getLayer("sam-rings-line")) {
      map.setLayoutProperty("sam-rings-line", "visibility", layers.showMissileRings ? "visible" : "none");
    }
    ["thermal-points-glow", "thermal-points-core"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", layers.showThermal ? "visible" : "none");
      }
    });
    ["vessel-points-core", "vessel-points-heading"].forEach((id) => {
      if (map.getLayer(id)) {
        map.setLayoutProperty(id, "visibility", layers.showVessels ? "visible" : "none");
      }
    });
    if (map.getLayer("track-trails-line")) {
      map.setLayoutProperty("track-trails-line", "visibility", layers.showTrails ? "visible" : "none");
    }
  }, [layers]);

  useEffect(() => {
    if (!mapRef.current || !flyToLocation) return;
    mapRef.current.flyTo({
      center: [flyToLocation.lng, flyToLocation.lat],
      zoom: flyToLocation.zoom,
      pitch: flyToLocation.pitch ?? 40,
      duration: 1600,
      essential: true,
    });
  }, [flyToLocation]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkerIds = new Set<string>();

    if (layers.showFlights) {
      liveFlights.forEach((f) => {
        const id = `flight-${f.icao24}`;
        currentMarkerIds.add(id);

        const isMil = f.category === "MILITARY";
        const isEmergency = Boolean(f.emergency);
        const stale = (f.coastAgeSec ?? 0) > COAST_LIMIT_SEC;

        // Colour encodes what the transponder actually told us, not a guess.
        const tone = isEmergency
          ? "bg-red-600/40 text-red-200 border-2 border-red-400 shadow-[0_0_18px_rgba(248,113,113,0.9)]"
          : isMil
          ? "bg-rose-600/30 text-rose-300 border-2 border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]"
          : f.category === "CARGO"
          ? "bg-amber-500/25 text-amber-200 border-2 border-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
          : f.category === "UNKNOWN"
          ? "bg-slate-500/25 text-slate-200 border-2 border-slate-400"
          : "bg-cyan-500/30 text-cyan-200 border-2 border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.7)]";

        const labelTone = isEmergency
          ? "text-red-300"
          : isMil
          ? "text-rose-400"
          : f.category === "CARGO"
          ? "text-amber-300"
          : f.category === "UNKNOWN"
          ? "text-slate-300"
          : "text-cyan-300";

        const altFt = f.altitudeFt ?? Math.round(f.baro_altitude * 3.28084);
        const subtitle = [
          f.aircraftType || null,
          `FL${String(Math.round(altFt / 100)).padStart(3, "0")}`,
          `${f.groundSpeedKts ?? Math.round(f.velocity * 1.94384)}kt`,
        ]
          .filter(Boolean)
          .join(" · ");

        const markup = `
          <div class="relative flex items-center justify-center">
            <div class="flight-arrow w-7 h-7 rounded-full ${tone} flex items-center justify-center font-bold text-xs transition-transform duration-200 hover:scale-125" style="transform: rotate(${f.true_track}deg);">
              ▲
            </div>
            ${
              isEmergency
                ? '<div class="absolute -inset-1 rounded-full border-2 border-red-400 animate-ping pointer-events-none"></div>'
                : ""
            }
          </div>
          <div class="contact-label mt-0.5 px-1.5 py-0.5 rounded bg-slate-950/95 border border-slate-700 text-[10px] font-mono font-bold ${labelTone} whitespace-nowrap shadow-xl leading-tight text-center">
            ${f.callsign}
            <div class="contact-sublabel text-[8px] text-slate-400 font-normal">${subtitle}</div>
          </div>
        `;

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = markup;
          el.onclick = () => selectTarget({ type: "FLIGHT", data: f });
          marker = new maplibregl.Marker({ element: el })
            .setLngLat([f.longitude, f.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([f.longitude, f.latitude]);
          const el = marker.getElement();
          const arrowEl = el.querySelector(".flight-arrow") as HTMLElement | null;
          if (arrowEl) arrowEl.style.transform = `rotate(${f.true_track}deg)`;
          // Keep the click handler bound to the latest observation.
          el.onclick = () => selectTarget({ type: "FLIGHT", data: f });
        }

        // A track we can no longer project is shown faded, never hidden.
        marker.getElement().style.opacity = stale ? "0.4" : "1";
        marker.getElement().title = stale
          ? `NO POSITION UPDATE FOR ${Math.round(f.coastAgeSec ?? 0)}s — position is last known, not current`
          : f.deadReckoned
          ? `Dead reckoned ${Math.round(f.coastAgeSec ?? 0)}s from last observed position`
          : "Observed position";
      });
    }

    if (layers.showSatellites) {
      liveSatellites.forEach((s) => {
        const id = `sat-${s.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center hover:scale-125 transition-transform";
          el.innerHTML = `
            <div class="w-7 h-7 rounded-full bg-indigo-500/40 border-2 border-indigo-400 text-indigo-200 flex items-center justify-center text-sm shadow-[0_0_15px_rgba(129,140,248,0.7)] animate-spin" style="animation-duration: 9s;">
              🛰️
            </div>
            <div class="mt-0.5 px-1.5 py-0.2 rounded bg-slate-950/95 border border-indigo-500/50 text-[9px] font-mono font-bold text-indigo-300 whitespace-nowrap shadow-xl">
              ${s.name.split(" ")[0]}
            </div>
          `;
          el.onclick = () => selectTarget({ type: "SATELLITE", data: s });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([s.longitude, s.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([s.longitude, s.latitude]);
        }
      });
    }

    if (layers.showDefenseBases) {
      defenseBases.forEach((b) => {
        const id = `base-${b.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center hover:scale-125 transition-transform";
          el.innerHTML = `
            <div class="w-7 h-7 rounded-lg bg-amber-500/30 border-2 border-amber-400 text-amber-300 flex items-center justify-center text-xs font-bold shadow-[0_0_14px_rgba(251,191,36,0.6)]">
              ★
            </div>
            <div class="mt-0.5 px-1.5 py-0.5 rounded bg-slate-950/95 border border-amber-500/60 text-[9px] font-mono text-amber-300 font-bold whitespace-nowrap shadow-xl">
              ${b.code}
            </div>
          `;
          el.onclick = () => selectTarget({ type: "BASE", data: b });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([b.longitude, b.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        }
      });
    }

    // Live UAV telemetry. Small fleet, so DOM markers keep the rich label.
    drones.forEach((d) => {
      const id = `drone-${d.vehicleId}`;
      currentMarkerIds.add(id);

      const tone =
        d.linkState === "LOST"
          ? "bg-slate-700/40 border-slate-500 text-slate-300"
          : d.linkState === "STALE"
          ? "bg-amber-600/30 border-amber-400 text-amber-200"
          : "bg-violet-600/35 border-violet-300 text-violet-100";

      const battery = d.batteryPercent != null ? `${Math.round(d.batteryPercent)}%` : "--";
      const markup = `
        <div class="relative flex items-center justify-center">
          <div class="drone-icon w-8 h-8 rounded-lg ${tone} border-2 flex items-center justify-center text-[13px] font-bold shadow-[0_0_16px_rgba(167,139,250,0.7)]" style="transform: rotate(${d.headingDeg}deg);">
            ✈
          </div>
        </div>
        <div class="contact-label mt-0.5 px-1.5 py-0.5 rounded bg-slate-950/95 border border-violet-500/50 text-[10px] font-mono font-bold text-violet-200 whitespace-nowrap shadow-xl leading-tight text-center">
          ${d.name}
          <div class="contact-sublabel text-[8px] text-slate-400 font-normal">
            ${Math.round(d.altitudeRelM)}m · ${Math.round(d.groundSpeedMs)}m/s · ${battery} · ${d.flightMode ?? "--"}
          </div>
        </div>
      `;

      let marker = markersRef.current[id];
      if (!marker) {
        const el = document.createElement("div");
        el.className = "cursor-pointer flex flex-col items-center";
        el.innerHTML = markup;
        marker = new maplibregl.Marker({ element: el })
          .setLngLat([d.longitude, d.latitude])
          .addTo(map);
        markersRef.current[id] = marker;
      } else {
        marker.setLngLat([d.longitude, d.latitude]);
        const icon = marker.getElement().querySelector(".drone-icon") as HTMLElement | null;
        if (icon) icon.style.transform = `rotate(${d.headingDeg}deg)`;
      }
      marker.getElement().style.opacity = d.linkState === "LOST" ? "0.45" : "1";
      marker.getElement().title =
        d.linkState === "LOST"
          ? "Telemetry link lost — position is last known"
          : `${d.name} · ${d.flightMode ?? "mode unknown"}`;
    });

    // Planned mission waypoints.
    if (mission) {
      mission.waypoints.forEach((w, i) => {
        const id = `wp-${i}`;
        currentMarkerIds.add(id);
        const isTerminal = w.action === "RTL" || w.action === "LAND";
        const badge =
          w.action === "TAKEOFF" ? "▲" : isTerminal ? "⏻" : w.action === "LOITER" ? "◉" : String(i);

        const markup = `
          <div class="w-6 h-6 rounded-full ${
            w.action === "TAKEOFF"
              ? "bg-emerald-500/40 border-emerald-300 text-emerald-100"
              : isTerminal
              ? "bg-rose-500/40 border-rose-300 text-rose-100"
              : "bg-cyan-500/40 border-cyan-300 text-cyan-50"
          } border-2 flex items-center justify-center text-[10px] font-bold shadow-lg">${badge}</div>
          <div class="contact-sublabel mt-0.5 px-1 rounded bg-slate-950/95 border border-slate-700 text-[8px] font-mono text-slate-300 whitespace-nowrap">
            ${w.label ?? w.action} · ${Math.round(w.altitudeM)}m
          </div>
        `;

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "flex flex-col items-center pointer-events-none";
          el.innerHTML = markup;
          marker = new maplibregl.Marker({ element: el })
            .setLngLat([w.longitude, w.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([w.longitude, w.latitude]);
          marker.getElement().innerHTML = markup;
        }
      });

      mission.conflicts.forEach((c, i) => {
        const id = `conflict-${i}`;
        currentMarkerIds.add(id);
        const markup = `
          <div class="w-7 h-7 rounded-full border-2 ${
            c.severity === "WARNING"
              ? "border-red-400 bg-red-600/40 text-red-100"
              : "border-amber-400 bg-amber-600/30 text-amber-100"
          } flex items-center justify-center text-[11px] font-bold animate-pulse">!</div>
          <div class="contact-sublabel mt-0.5 px-1 rounded bg-slate-950/95 border border-red-600/50 text-[8px] font-mono text-red-200 whitespace-nowrap">${c.callsign}</div>
        `;
        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "flex flex-col items-center pointer-events-none";
          el.innerHTML = markup;
          marker = new maplibregl.Marker({ element: el })
            .setLngLat([c.longitude, c.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([c.longitude, c.latitude]);
          marker.getElement().innerHTML = markup;
        }
      });
    }

    // Mission route line and geofence ring.
    const routeSource = map.getSource("mission-route") as maplibregl.GeoJSONSource | undefined;
    if (routeSource) {
      const coords = (mission?.waypoints ?? []).map(
        (w) => [w.longitude, w.latitude] as [number, number]
      );
      routeSource.setData({
        type: "FeatureCollection",
        features:
          coords.length > 1
            ? [
                {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: coords },
                },
              ]
            : [],
      });
    }

    const fenceSource = map.getSource("mission-geofence") as maplibregl.GeoJSONSource | undefined;
    if (fenceSource) {
      fenceSource.setData({
        type: "FeatureCollection",
        features: mission?.geofenceRing
          ? [
              {
                type: "Feature",
                properties: {},
                geometry: { type: "Polygon", coordinates: [mission.geofenceRing] },
              },
            ]
          : [],
      });
    }

    const droneTrailSource = map.getSource("drone-trails") as maplibregl.GeoJSONSource | undefined;
    if (droneTrailSource) {
      droneTrailSource.setData({
        type: "FeatureCollection",
        features: drones
          .filter((d) => (d.history?.length ?? 0) > 1)
          .map((d) => ({
            type: "Feature" as const,
            properties: { id: d.vehicleId },
            geometry: { type: "LineString" as const, coordinates: d.history! },
          })),
      });
    }

    // Maritime contacts.
    const vesselSource = map.getSource("vessel-points") as maplibregl.GeoJSONSource | undefined;
    if (vesselSource) {
      vesselSource.setData({
        type: "FeatureCollection",
        features: layers.showVessels
          ? liveVessels.map((v) => ({
              type: "Feature" as const,
              properties: {
                mmsi: v.mmsi,
                kind: v.type,
                cog: v.heading,
                name: v.name,
                speed: v.speed,
                flag: v.flag,
              },
              geometry: { type: "Point" as const, coordinates: [v.longitude, v.latitude] },
            }))
          : [],
      });
    }

    // Thermal detections.
    const thermalSource = map.getSource("thermal-points") as maplibregl.GeoJSONSource | undefined;
    if (thermalSource) {
      thermalSource.setData({
        type: "FeatureCollection",
        features: layers.showThermal
          ? thermalAnomalies.map((th) => ({
              type: "Feature" as const,
              properties: {
                id: th.id,
                frp: th.frp ?? 0,
                brightness: th.brightness,
                confidence: th.confidence,
                satellite: th.satellite,
                detectionTime: th.detectionTime,
                area: th.areaDescription,
              },
              geometry: { type: "Point" as const, coordinates: [th.longitude, th.latitude] },
            }))
          : [],
      });
    }

    // Push observed position history into the trail layer.
    const trailSource = map.getSource("track-trails") as maplibregl.GeoJSONSource | undefined;
    if (trailSource) {
      const features: GeoJSON.Feature[] = [];

      if (layers.showTrails && layers.showFlights) {
        liveFlights.forEach((f) => {
          if (!f.history || f.history.length < 2) return;
          features.push({
            type: "Feature",
            properties: { kind: f.category, id: f.icao24 },
            geometry: { type: "LineString", coordinates: f.history },
          });
        });
      }

      if (layers.showTrails && layers.showVessels) {
        liveVessels.forEach((v) => {
          if (!v.history || v.history.length < 2) return;
          features.push({
            type: "Feature",
            properties: { kind: "VESSEL", id: v.mmsi },
            geometry: { type: "LineString", coordinates: v.history },
          });
        });
      }

      trailSource.setData({ type: "FeatureCollection", features });
    }

    Object.keys(markersRef.current).forEach((key) => {
      if (!currentMarkerIds.has(key)) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });
  }, [
    liveFlights,
    liveVessels,
    liveSatellites,
    defenseBases,
    thermalAnomalies,
    drones,
    mission,
    layers,
    onSelectTarget,
  ]);

  return (
    <div className="relative w-full h-full bg-[#020611] overflow-hidden">
      <div
        ref={mapContainer}
        className={`w-full h-full ${planningMode ? "cursor-crosshair" : ""}`}
      />

      {planningMode && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 tactical-glass px-3 py-1.5 rounded-lg border border-cyan-400/60 text-[11px] font-mono text-cyan-200 shadow-xl">
          MISSION PLANNING — click the map to place a waypoint
        </div>
      )}

      {/* Realistic Map Mode Selector */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 tactical-glass px-2 py-1.5 rounded-xl border border-cyan-500/40 text-xs font-mono flex items-center gap-1 shadow-2xl">
        <button
          onClick={() => setMapStyleMode("GOOGLE_SAT_HD")}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            mapStyleMode === "GOOGLE_SAT_HD"
              ? "bg-emerald-600 text-white font-bold shadow-md shadow-emerald-900"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <SatIcon className="w-3.5 h-3.5" />
          🛰️ SUB-METER SATELLITE (HD)
        </button>

        <button
          onClick={() => setMapStyleMode("HYBRID_ROADS")}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            mapStyleMode === "HYBRID_ROADS"
              ? "bg-cyan-600 text-white font-bold shadow-md shadow-cyan-900"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <Globe className="w-3.5 h-3.5" />
          HYBRID (SATELLITE + ROADS)
        </button>

        <button
          onClick={() => setMapStyleMode("ESRI_SAT_4K")}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            mapStyleMode === "ESRI_SAT_4K"
              ? "bg-indigo-600 text-white font-bold shadow-md"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <SatIcon className="w-3.5 h-3.5" />
          ESRI 4K TERRAIN
        </button>

        <button
          onClick={() => setMapStyleMode("STREETS_TOPO")}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            mapStyleMode === "STREETS_TOPO"
              ? "bg-blue-600 text-white font-bold shadow-md"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <MapIcon className="w-3.5 h-3.5" />
          STREETS & CITIES
        </button>

        <button
          onClick={() => setMapStyleMode("TACTICAL_DARK")}
          className={`px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all ${
            mapStyleMode === "TACTICAL_DARK"
              ? "bg-slate-800 text-emerald-400 font-bold border border-emerald-500/50 shadow-md"
              : "text-slate-400 hover:text-white hover:bg-slate-800/60"
          }`}
        >
          <Moon className="w-3.5 h-3.5" />
          TACTICAL DARK
        </button>
      </div>

      {layers.radarSweepAnim && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden opacity-25">
          <div className="w-[880px] h-[880px] rounded-full border border-emerald-500/30 relative animate-radar-sweep">
            <div className="absolute top-0 right-1/2 w-1/2 h-1/2 bg-gradient-to-bl from-emerald-500/25 via-transparent to-transparent origin-bottom-right rounded-tl-full" />
          </div>
        </div>
      )}

      {/* LIVE MILITARY CAMERA & ELEVATION TELEMETRY HUD BAR */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 tactical-glass px-5 py-2 rounded-2xl border border-cyan-500/40 text-xs font-mono text-cyan-300 flex flex-wrap items-center gap-4 shadow-2xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
          <span className="font-bold text-emerald-400">{cameraTelemetry.sector}</span>
        </div>

        <span className="w-[1px] h-4 bg-slate-700" />

        <div className="flex items-center gap-1.5 text-slate-200">
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          <span>ALT: <strong>{cameraTelemetry.altitudeMeters >= 1000 ? `${(cameraTelemetry.altitudeMeters / 1000).toFixed(1)} km` : `${cameraTelemetry.altitudeMeters} m`}</strong></span>
        </div>

        <span className="w-[1px] h-4 bg-slate-700" />

        <div className="flex items-center gap-1.5 text-slate-200">
          <Crosshair className="w-3.5 h-3.5 text-amber-400" />
          <span>ZOOM: <strong>{cameraTelemetry.zoom}x</strong></span>
        </div>

        <span className="w-[1px] h-4 bg-slate-700" />

        <div className="flex items-center gap-1.5 text-slate-200">
          <Compass className="w-3.5 h-3.5 text-purple-400" />
          <span>HDG: <strong>{cameraTelemetry.bearing}°</strong></span>
          <span className="text-slate-500">|</span>
          <span>TILT: <strong>{cameraTelemetry.pitch}°</strong></span>
        </div>

        <span className="w-[1px] h-4 bg-slate-700" />

        <div className="text-slate-300">
          LAT: <strong>{cameraTelemetry.lat.toFixed(4)}°N</strong> | LON: <strong>{cameraTelemetry.lng.toFixed(4)}°E</strong>
        </div>
      </div>
    </div>
  );
};
