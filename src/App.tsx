import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { ScenegraphLayer } from "@deck.gl/mesh-layers";
import type { PicnicTable } from "./types";
import tables from "virtual:tables";

const SATELLITE_STYLE = "mapbox://styles/mapbox/satellite-streets-v12";
const HELLMAN_HOLLOW: [number, number] = [-122.4862, 37.7694];

const layers = tables
  .filter((t) => t.longitude != null && t.latitude != null)
  .map(
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
      })
  );

export default function App() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: SATELLITE_STYLE,
      center: HELLMAN_HOLLOW,
      zoom: 18.5,
      pitch: 60,
      bearing: -30,
      antialias: true,
    });

    map.addControl(new mapboxgl.NavigationControl(), "top-left");

    const overlay = new MapboxOverlay({
      interleaved: true,
      layers,
    });
    map.addControl(overlay as unknown as mapboxgl.IControl);

    return () => {
      map.remove();
    };
  }, []);

  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}
