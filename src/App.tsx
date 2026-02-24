import { useEffect, useRef, useState, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { PicnicTable } from "./types";
import tables from "virtual:tables";

const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const GGP_CENTER: [number, number] = [-122.4786, 37.7694];
const GGP_ZOOM = 13.5;
const HELLMAN_CENTER: [number, number] = [-122.4843, 37.7692];
const HELLMAN_ZOOM = 19;
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-122.495, 37.762],
  [-122.475, 37.776],
];

type Phase = "landing" | "flying" | "explored";

const placedTables = tables.filter(
  (t) => t.longitude != null && t.latitude != null,
);

function buildLayers() {
  return placedTables.map(
    (t) =>
      new ScenegraphLayer({
        id: `model-${t.id}`,
        data: [t],
        scenegraph: `/model/${encodeURIComponent(t.model_file.replace("model/", ""))}`,
        getPosition: (d: PicnicTable) => [
          d.longitude!,
          d.latitude!,
          d.altitude,
        ],
        getOrientation: (d: PicnicTable) => [
          d.rotation_x,
          d.rotation_y,
          d.rotation_z,
        ],
        getScale: (d: PicnicTable) => [d.scale_x, d.scale_y, d.scale_z],
        sizeScale: 1,
        _lighting: "pbr",
        parameters: { depthTest: true },
        pickable: true,
      }),
  );
}

function createTagElement(table: PicnicTable): HTMLElement {
  const el = document.createElement("div");
  const num = table.name.replace("GG Table ", "");
  const displayName = table.name.replace("GG ", "");
  const thumbUrl = `/thumbs/${encodeURIComponent(table.name)}.jpg`;

  el.innerHTML = `
    <div class="tag-card">
      <div class="tag-thumb">
        <img src="${thumbUrl}" onerror="this.style.display='none'" />
        <span>${num}</span>
      </div>
      <span class="tag-name">${displayName}</span>
    </div>
  `;
  return el;
}

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const [phase, setPhase] = useState<Phase>("landing");

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: GGP_CENTER,
      zoom: GGP_ZOOM,
      pitch: 0,
      bearing: 0,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-left");
    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const handleExplore = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    setPhase("flying");

    map.flyTo({
      center: HELLMAN_CENTER,
      zoom: HELLMAN_ZOOM,
      pitch: 0,
      bearing: 0,
      duration: 4000,
      essential: true,
    });

    map.once("moveend", () => {
      map.setMaxBounds(MAX_BOUNDS);

      const overlay = new MapboxOverlay({
        interleaved: true,
        layers: buildLayers(),
      });
      map.addControl(overlay as unknown as mapboxgl.IControl);

      for (const t of placedTables) {
        const el = createTagElement(t);
        new mapboxgl.Marker({
          element: el,
          anchor: "bottom",
          offset: [0, -10],
        })
          .setLngLat([t.longitude!, t.latitude!])
          .addTo(map);
      }

      setPhase("explored");
    });
  }, []);

  const overlayVisible = phase === "landing";
  const overlayGone = phase === "explored";

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />

      {!overlayGone && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.25) 0%, rgba(0,0,0,0.6) 100%)",
            opacity: overlayVisible ? 1 : 0,
            transition: "opacity 1.5s ease-out",
            pointerEvents: overlayVisible ? "auto" : "none",
            zIndex: 10,
          }}
        >
          <p className="landing-eyebrow">Golden Gate Park, San Francisco</p>

          <h1 className="landing-title">
            Hellman Hollow
            <br />
            <span>Picnic Tables</span>
          </h1>

          <p className="landing-subtitle">
            12 3D-scanned picnic tables capturing the graffiti
            <br />
            written by park visitors over the years
          </p>

          <button className="landing-btn" onClick={handleExplore}>
            Explore
          </button>
        </div>
      )}
    </div>
  );
}
