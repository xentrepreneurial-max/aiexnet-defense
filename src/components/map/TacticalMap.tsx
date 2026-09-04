"use client";

import React, { useEffect, useRef } from "react";
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
  flights,
  vessels,
  satellites,
  defenseBases,
  thermalAnomalies,
  layers,
  onSelectTarget,
  flyToLocation,
}) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<{ [key: string]: maplibregl.Marker }>({});

  // Initialize Map
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      // High-performance tactical dark style with standard OpenStreetMap/Carto Dark fallback
      style: {
        version: 8,
        sources: {
          "carto-dark": {
            type: "raster",
            tiles: [
              "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
              "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
              "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
              "https://d.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors, © CARTO",
          },
        },
        layers: [
          {
            id: "carto-dark-layer",
            type: "raster",
            source: "carto-dark",
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      },
      center: [90.3563, 23.6850], // Centered on Bangladesh
      zoom: 6.2,
      pitch: 35,
      bearing: -5,
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: true }), "top-right");

    map.on("load", () => {
      // Add ADIZ and EEZ GeoJSON Polygons and Radar Rings once map loads
      setupTacticalGeoJSONLayers(map);
    });

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Helper to create circle polygon GeoJSON for radar / SAM rings
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
    // 1. Bangladesh ADIZ (Air Defense Identification Zone) Boundary
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

    map.addSource("adiz-boundary", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: { name: "BD ADIZ" },
        geometry: {
          type: "Polygon",
          coordinates: [adizCoords],
        },
      },
    });

    map.addLayer({
      id: "adiz-layer-fill",
      type: "fill",
      source: "adiz-boundary",
      paint: {
        "fill-color": "#8b5cf6",
        "fill-opacity": 0.05,
      },
    });

    map.addLayer({
      id: "adiz-layer-line",
      type: "line",
      source: "adiz-boundary",
      paint: {
        "line-color": "#a78bfa",
        "line-width": 2,
        "line-dasharray": [4, 2],
      },
    });

    // 2. Maritime EEZ (Exclusive Economic Zone) in Bay of Bengal
    const eezCoords = [
      [89.15, 21.65],
      [89.10, 19.20],
      [91.10, 17.50],
      [92.40, 19.80],
      [92.35, 20.80],
      [89.15, 21.65],
    ];

    map.addSource("eez-boundary", {
      type: "geojson",
      data: {
        type: "Feature",
        properties: { name: "BD Maritime EEZ" },
        geometry: {
          type: "Polygon",
          coordinates: [eezCoords],
        },
      },
    });

    map.addLayer({
      id: "eez-layer-fill",
      type: "fill",
      source: "eez-boundary",
      paint: {
        "fill-color": "#0284c7",
        "fill-opacity": 0.08,
      },
    });

    map.addLayer({
      id: "eez-layer-line",
      type: "line",
      source: "eez-boundary",
      paint: {
        "line-color": "#38bdf8",
        "line-width": 1.8,
        "line-dasharray": [3, 2],
      },
    });

    // 3. Radar & SAM Ranges Source
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
        "line-color": "#14b8a6",
        "line-width": 1.2,
        "line-opacity": 0.6,
      },
    });

    map.addLayer({
      id: "sam-rings-line",
      type: "line",
      source: "defense-ranges",
      filter: ["==", "type", "SAM"],
      paint: {
        "line-color": "#f43f5e",
        "line-width": 1.5,
        "line-dasharray": [2, 2],
        "line-opacity": 0.7,
      },
    });
  };

  // Sync Layer Visibility with toggles
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

  // Handle Fly-To presets
  useEffect(() => {
    if (!mapRef.current || !flyToLocation) return;
    mapRef.current.flyTo({
      center: [flyToLocation.lng, flyToLocation.lat],
      zoom: flyToLocation.zoom,
      pitch: flyToLocation.pitch ?? 35,
      duration: 1800,
      essential: true,
    });
  }, [flyToLocation]);

  // Render & Update Markers (Flights, Vessels, Satellites, Bases, Thermal)
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkerIds = new Set<string>();

    // 1. FLIGHT MARKERS
    if (layers.showFlights) {
      flights.forEach((f) => {
        const id = `flight-${f.icao24}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        const isMil = f.category === "MILITARY" || f.threatLevel === "HIGH";

        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="relative flex items-center justify-center">
              <div class="w-6 h-6 rounded-full ${isMil ? 'bg-rose-500/20 text-rose-400 border border-rose-400 animate-pulse' : 'bg-cyan-500/20 text-cyan-400 border border-cyan-400'} flex items-center justify-center shadow-lg transition-transform hover:scale-125" style="transform: rotate(${f.true_track}deg);">
                ▲
              </div>
            </div>
            <div class="mt-0.5 px-1 py-0.2 rounded bg-slate-950/90 border border-slate-700 text-[9px] font-mono ${isMil ? 'text-rose-400 font-bold' : 'text-cyan-300'} whitespace-nowrap shadow-md">
              ${f.callsign}
            </div>
          `;
          el.onclick = () => onSelectTarget({ type: "FLIGHT", data: f });

          marker = new maplibregl.Marker({ element: el })
            .setLngLat([f.longitude, f.latitude])
            .addTo(map);
          markersRef.current[id] = marker;
        } else {
          marker.setLngLat([f.longitude, f.latitude]);
        }
      });
    }

    // 2. VESSEL MARKERS
    if (layers.showVessels) {
      vessels.forEach((v) => {
        const id = `vessel-${v.mmsi}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        const isNaval = v.type === "NAVAL" || v.type === "SUBMARINE";

        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-5 h-5 rounded ${isNaval ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-400' : 'bg-blue-500/20 text-blue-300 border border-blue-400'} flex items-center justify-center text-[10px] shadow-lg transition-transform hover:scale-125" style="transform: rotate(${v.heading}deg);">
              ◆
            </div>
            <div class="mt-0.5 px-1 py-0.2 rounded bg-slate-950/90 border border-slate-700 text-[9px] font-mono text-emerald-300 whitespace-nowrap">
              ${v.name.split(' ')[0]}
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

    // 3. SATELLITE MARKERS
    if (layers.showSatellites) {
      satellites.forEach((s) => {
        const id = `sat-${s.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-6 h-6 rounded-full bg-indigo-500/30 border border-indigo-400 text-indigo-300 flex items-center justify-center text-xs shadow-lg animate-spin" style="animation-duration: 8s;">
              🛰️
            </div>
            <div class="mt-0.5 px-1 py-0.2 rounded bg-slate-950/90 border border-indigo-500/40 text-[9px] font-mono text-indigo-300 whitespace-nowrap">
              ${s.name.split(' ')[0]}
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

    // 4. DEFENSE BASES
    if (layers.showDefenseBases) {
      defenseBases.forEach((b) => {
        const id = `base-${b.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-6 h-6 rounded-lg bg-amber-500/30 border-2 border-amber-400 text-amber-300 flex items-center justify-center text-xs font-bold shadow-lg">
              ★
            </div>
            <div class="mt-0.5 px-1.5 py-0.5 rounded bg-slate-950/95 border border-amber-500/50 text-[9px] font-mono text-amber-300 font-bold whitespace-nowrap">
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

    // 5. THERMAL ANOMALIES
    if (layers.showThermal) {
      thermalAnomalies.forEach((th) => {
        const id = `thermal-${th.id}`;
        currentMarkerIds.add(id);

        let marker = markersRef.current[id];
        if (!marker) {
          const el = document.createElement("div");
          el.className = "cursor-pointer group flex flex-col items-center";
          el.innerHTML = `
            <div class="w-5 h-5 rounded-full bg-red-600/40 border-2 border-red-500 text-red-300 flex items-center justify-center text-[10px] animate-ping">
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

    // Clean up markers that are toggled off
    Object.keys(markersRef.current).forEach((key) => {
      if (!currentMarkerIds.has(key)) {
        markersRef.current[key].remove();
        delete markersRef.current[key];
      }
    });
  }, [flights, vessels, satellites, defenseBases, thermalAnomalies, layers, onSelectTarget]);

  return (
    <div className="relative w-full h-full bg-[#030712] overflow-hidden">
      {/* MapLibre Canvas Container */}
      <div ref={mapContainer} className="w-full h-full" />

      {/* Radar Sweep Animation Effect Overlay */}
      {layers.radarSweepAnim && (
        <div className="absolute inset-0 pointer-events-none flex items-center justify-center overflow-hidden opacity-30">
          <div className="w-[850px] h-[850px] rounded-full border border-emerald-500/30 relative animate-radar-sweep">
            <div className="absolute top-0 right-1/2 w-1/2 h-1/2 bg-gradient-to-bl from-emerald-500/20 via-transparent to-transparent origin-bottom-right rounded-tl-full" />
          </div>
        </div>
      )}

      {/* Bottom Coordinates & Azimuth Compass Badge */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 tactical-glass px-4 py-1.5 rounded-full border border-cyan-500/30 text-[11px] font-mono text-cyan-300 flex items-center gap-4 shadow-xl">
        <span>GRID: 23°41&apos;N 90°23&apos;E (DHAKA)</span>
        <span className="w-1 h-3 bg-slate-700" />
        <span className="text-emerald-400">GEO-STATIONARY LOCK: STABLE</span>
        <span className="w-1 h-3 bg-slate-700" />
        <span className="text-amber-400">MGRS: 46R CK 382 284</span>
      </div>
    </div>
  );
};
