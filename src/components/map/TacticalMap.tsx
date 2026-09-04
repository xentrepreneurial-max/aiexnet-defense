"use client";

import React, { useEffect, useRef, useState } from "react";
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

interface TacticalMapProps {
  flights: FlightData[];
  vessels: VesselData[];
  satellites: SatelliteData[];
  defenseBases: DefenseBase[];
  thermalAnomalies: ThermalAnomaly[];
  layers: LayerState;
  onSelectTarget: (target: SelectedTarget) => void;
  flyToLocation: { lng: number; lat: number; zoom: number; pitch?: number } | null;
}

export const TacticalMap: React.FC<TacticalMapProps> = ({
  flights: initialFlights,
  vessels: initialVessels,
  satellites: initialSatellites,
  defenseBases,
  thermalAnomalies,
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

  // Local state for smooth real-time interpolated movement
  const [liveFlights, setLiveFlights] = useState<FlightData[]>(initialFlights);
  const [liveVessels, setLiveVessels] = useState<VesselData[]>(initialVessels);
  const [liveSatellites, setLiveSatellites] = useState<SatelliteData[]>(initialSatellites);

  useEffect(() => {
    setLiveFlights(initialFlights);
  }, [initialFlights]);

  useEffect(() => {
    setLiveVessels(initialVessels);
  }, [initialVessels]);

  useEffect(() => {
    setLiveSatellites(initialSatellites);
  }, [initialSatellites]);

  // High-performance 60FPS continuous movement animation loop
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = performance.now();

    const animateMovement = (currentTime: number) => {
      const deltaSec = (currentTime - lastTime) / 1000;
      lastTime = currentTime;

      if (deltaSec > 0 && deltaSec < 1) {
        // 1. Move flights along heading (true_track)
        setLiveFlights((prev) =>
          prev.map((f) => {
            const speedKts = f.velocity * 1.94384 || 250;
            const distanceDeg = (speedKts * 0.000003) * deltaSec * 8;
            const rad = (f.true_track * Math.PI) / 180;
            return {
              ...f,
              latitude: f.latitude + Math.cos(rad) * distanceDeg,
              longitude: f.longitude + (Math.sin(rad) * distanceDeg) / Math.cos((f.latitude * Math.PI) / 180),
            };
          })
        );

        // 2. Move ships along heading
        setLiveVessels((prev) =>
          prev.map((v) => {
            const distanceDeg = (v.speed * 0.000002) * deltaSec * 6;
            const rad = (v.heading * Math.PI) / 180;
            return {
              ...v,
              latitude: v.latitude + Math.cos(rad) * distanceDeg,
              longitude: v.longitude + (Math.sin(rad) * distanceDeg) / Math.cos((v.latitude * Math.PI) / 180),
            };
          })
        );

        // 3. Move satellites in orbit
        setLiveSatellites((prev) =>
          prev.map((s) => {
            if (s.type === "COMMUNICATION") return s;
            const step = 0.015 * deltaSec * 3;
            return {
              ...s,
              latitude: s.latitude > 85 ? -85 : s.latitude + step,
              longitude: ((s.longitude + step * 0.8 + 180) % 360) - 180,
            };
          })
        );
      }

      animationFrameId = requestAnimationFrame(animateMovement);
    };

    animationFrameId = requestAnimationFrame(animateMovement);
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

    // 4. Radar & SAM Ranges
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

    map.on("load", () => {
      setupTacticalGeoJSONLayers(map);
    });

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

        let marker = markersRef.current[id];
        const isMil = f.category === "MILITARY" || f.threatLevel === "HIGH";

        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="relative flex items-center justify-center">
              <div class="flight-arrow w-7 h-7 rounded-full ${
                isMil
                  ? "bg-rose-600/30 text-rose-400 border-2 border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.8)]"
                  : "bg-cyan-500/30 text-cyan-300 border-2 border-cyan-400 shadow-[0_0_12px_rgba(0,229,255,0.7)]"
              } flex items-center justify-center font-bold text-xs transition-transform duration-200 hover:scale-130" style="transform: rotate(${f.true_track}deg);">
                ▲
              </div>
            </div>
            <div class="mt-0.5 px-1.5 py-0.2 rounded bg-slate-950/95 border border-slate-700 text-[10px] font-mono font-bold ${
              isMil ? "text-rose-400" : "text-cyan-300"
            } whitespace-nowrap shadow-xl">
              ${f.callsign} <span class="text-[8px] text-slate-400 font-normal">(${Math.round(f.baro_altitude)}m)</span>
            </div>
          `;
          el.onclick = () => onSelectTarget({ type: "FLIGHT", data: f });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([f.longitude, f.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([f.longitude, f.latitude]);
          const arrowEl = marker.getElement().querySelector(".flight-arrow") as HTMLElement;
          if (arrowEl) arrowEl.style.transform = `rotate(${f.true_track}deg)`;
        }
      });
    }

    if (layers.showVessels) {
      liveVessels.forEach((v) => {
        const id = `vessel-${v.mmsi}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        const isNaval = v.type === "NAVAL" || v.type === "SUBMARINE";

        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-6 h-6 rounded ${
              isNaval
                ? "bg-emerald-500/30 text-emerald-300 border-2 border-emerald-400 shadow-[0_0_12px_rgba(0,255,136,0.6)]"
                : "bg-blue-500/30 text-blue-300 border-2 border-blue-400"
            } flex items-center justify-center text-xs font-bold shadow-lg hover:scale-130 transition-transform" style="transform: rotate(${v.heading}deg);">
              ◆
            </div>
            <div class="mt-0.5 px-1.5 py-0.2 rounded bg-slate-950/95 border border-slate-700 text-[9px] font-mono font-bold text-emerald-300 whitespace-nowrap shadow-xl">
              ${v.name.split(" ")[0]}
            </div>
          `;
          el.onclick = () => onSelectTarget({ type: "VESSEL", data: v });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([v.longitude, v.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([v.longitude, v.latitude]);
        }
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
          el.onclick = () => onSelectTarget({ type: "SATELLITE", data: s });

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
          el.onclick = () => onSelectTarget({ type: "BASE", data: b });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([b.longitude, b.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        }
      });
    }

    if (layers.showThermal) {
      thermalAnomalies.forEach((th) => {
        const id = `thermal-${th.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-6 h-6 rounded-full bg-red-600/40 border-2 border-red-500 text-red-300 flex items-center justify-center text-xs animate-ping shadow-[0_0_12px_rgba(239,68,68,0.8)]">
              🔥
            </div>
          `;
          el.onclick = () => onSelectTarget({ type: "THERMAL", data: th });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([th.longitude, th.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        }
      });
    }

    Object.keys(markersRef.current).forEach((key) => {
      if (!currentMarkerIds.has(key)) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });
  }, [liveFlights, liveVessels, liveSatellites, defenseBases, thermalAnomalies, layers, onSelectTarget]);

  return (
    <div className="relative w-full h-full bg-[#020611] overflow-hidden">
      <div ref={mapContainer} className="w-full h-full" />

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
