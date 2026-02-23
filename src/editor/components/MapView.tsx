import { useEffect, useRef, useCallback, useState } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { PicnicTable } from "../../types";

const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const STREETS_STYLE = "mapbox://styles/mapbox/streets-v12";

const HELLMAN_HOLLOW: [number, number] = [-122.4862, 37.7694];

interface MapViewProps {
  tables: PicnicTable[];
  selectedId: number | null;
  onMapClick: (lng: number, lat: number) => void;
  onSelectTable: (id: number) => void;
}

function buildDeckLayers(tables: PicnicTable[], selectedId: number | null) {
  const placed = tables.filter(
    (t) => t.longitude != null && t.latitude != null
  );

  return placed.map(
    (t) =>
      new ScenegraphLayer({
        id: `model-${t.id}`,
        data: [t],
        scenegraph: `/model/${encodeURIComponent(t.model_file.replace("model/", ""))}`,
        getPosition: (d: PicnicTable) => [d.longitude!, d.latitude!, d.altitude],
        getOrientation: (d: PicnicTable) => [d.rotation_x, d.rotation_y, d.rotation_z],
        getScale: (d: PicnicTable) => [d.scale_x, d.scale_y, d.scale_z],
        sizeScale: 1,
        _lighting: "pbr",
        parameters: { depthTest: true },
        pickable: true,
        opacity: t.id === selectedId ? 1 : 0.85,
      })
  );
}

export default function MapView({
  tables,
  selectedId,
  onMapClick,
  onSelectTable,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const markersRef = useRef<Map<number, mapboxgl.Marker>>(new Map());
  const isSatelliteRef = useRef(true);
  const [, setMapReady] = useState(false);

  const onMapClickRef = useRef(onMapClick);
  onMapClickRef.current = onMapClick;

  const onSelectTableRef = useRef(onSelectTable);
  onSelectTableRef.current = onSelectTable;

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: HELLMAN_HOLLOW,
      zoom: 19,
      pitch: 60,
      bearing: 0,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-left");

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers: [],
    });
    map.addControl(overlay as unknown as mapboxgl.IControl);
    overlayRef.current = overlay;

    map.on("click", (e) => {
      onMapClickRef.current(e.lngLat.lng, e.lngLat.lat);
    });

    map.on("load", () => setMapReady(true));
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    if (!overlayRef.current) return;
    overlayRef.current.setProps({
      layers: buildDeckLayers(tables, selectedId),
    });
  }, [tables, selectedId]);

  const syncMarkers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    const activeIds = new Set<number>();

    for (const t of tables) {
      if (t.longitude == null || t.latitude == null) continue;
      activeIds.add(t.id);

      let marker = markersRef.current.get(t.id);
      const isSelected = t.id === selectedId;

      if (marker) {
        marker.setLngLat([t.longitude, t.latitude]);
        const el = marker.getElement();
        el.style.background = isSelected ? "#3b82f6" : "#ef4444";
        el.style.border = isSelected ? "3px solid #fff" : "2px solid #fff";
        el.style.width = isSelected ? "20px" : "14px";
        el.style.height = isSelected ? "20px" : "14px";
      } else {
        const el = document.createElement("div");
        el.style.width = isSelected ? "20px" : "14px";
        el.style.height = isSelected ? "20px" : "14px";
        el.style.borderRadius = "50%";
        el.style.background = isSelected ? "#3b82f6" : "#ef4444";
        el.style.border = isSelected ? "3px solid #fff" : "2px solid #fff";
        el.style.cursor = "pointer";
        el.style.boxShadow = "0 1px 4px rgba(0,0,0,0.4)";
        el.style.transition = "all 0.15s ease";

        const tableId = t.id;
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelectTableRef.current(tableId);
        });

        marker = new mapboxgl.Marker({ element: el })
          .setLngLat([t.longitude, t.latitude])
          .addTo(map);

        markersRef.current.set(t.id, marker);
      }
    }

    for (const [id, marker] of markersRef.current) {
      if (!activeIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [tables, selectedId]);

  useEffect(() => {
    syncMarkers();
  }, [syncMarkers]);

  const toggleStyle = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const next = isSatelliteRef.current ? STREETS_STYLE : SATELLITE_STYLE;
    isSatelliteRef.current = !isSatelliteRef.current;

    map.once("style.load", () => syncMarkers());
    map.setStyle(next);
  }, [syncMarkers]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
      <button
        onClick={toggleStyle}
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          zIndex: 1,
          padding: "6px 12px",
          background: "#fff",
          border: "1px solid #ccc",
          borderRadius: 4,
          cursor: "pointer",
          fontSize: 13,
          fontWeight: 500,
          boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
        }}
      >
        Toggle Satellite
      </button>
    </div>
  );
}
