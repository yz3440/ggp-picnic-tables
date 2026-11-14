import { useEffect, useRef, useState, type CSSProperties } from "react";
import { EditorScene } from "../../scene/editor-scene";
import { tableTag, tableTitle } from "../../lib/utils";
import type { PicnicTable } from "../../types";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || null;

export interface MapApi {
  /** The altitude that stands the table on the ground around it, measured from
   *  what the map shows now; null if too little of that ground is in view. */
  groundUnder: (table: PicnicTable) => number | null;
}

interface MapViewProps {
  tables: PicnicTable[];
  selectedId: number | null;
  /** `altitude` is the ground's height there (above GROUND), when it could be measured. */
  onMapClick: (lng: number, lat: number, altitude: number | null) => void;
  onSelectTable: (id: number) => void;
  onReady?: (api: MapApi) => void;
}

/** Google's 3D tiles with the scans in them, as the site shows them. */
export default function MapView({ tables, selectedId, onMapClick, onSelectTable, onReady }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<EditorScene | null>(null);
  const tagEls = useRef(new Map<number, HTMLElement>());
  const [attribution, setAttribution] = useState("");

  const handlers = useRef({ onMapClick, onSelectTable });
  handlers.current = { onMapClick, onSelectTable };
  const latest = useRef({ tables, selectedId });
  latest.current = { tables, selectedId };

  useEffect(() => {
    const scene = new EditorScene(containerRef.current!, canvasRef.current!, API_KEY);
    scene.onPick = (pick) => {
      if (pick.type === "select") handlers.current.onSelectTable(pick.id);
      else handlers.current.onMapClick(pick.lon, pick.lat, pick.altitude);
    };
    scene.onAttributions = setAttribution;
    for (const [id, el] of tagEls.current) scene.setTag(id, el);
    scene.setTables(latest.current.tables);
    scene.setSelected(latest.current.selectedId);
    sceneRef.current = scene;
    onReady?.({ groundUnder: (t) => scene.groundUnder(t) });
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => sceneRef.current?.setTables(tables), [tables]);
  useEffect(() => sceneRef.current?.setSelected(selectedId), [selectedId]);

  const placed = tables.filter((t) => t.longitude != null && t.latitude != null);

  return (
    <div ref={containerRef} style={{ position: "relative", width: "100%", height: "100%", overflow: "hidden" }}>
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%", touchAction: "none" }} />
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {placed.map((t) => (
          <button
            key={t.id}
            type="button"
            ref={(el) => {
              if (el) tagEls.current.set(t.id, el);
              else tagEls.current.delete(t.id);
              sceneRef.current?.setTag(t.id, el);
            }}
            onClick={() => onSelectTable(t.id)}
            title={tableTitle(t)}
            style={tagStyle(t.id === selectedId)}
          >
            {tableTag(t)}
          </button>
        ))}
      </div>
      {!API_KEY && (
        <div style={{ ...noteStyle, top: 10, left: 10 }}>
          Add VITE_GOOGLE_MAPS_API_KEY to .env (with the Map Tiles API enabled) to load Google’s 3D tiles.
        </div>
      )}
      <div style={{ ...noteStyle, top: 10, right: 10 }}>
        Click to place the selected table · click a table to select it · drag to pan · right-drag to turn · scroll to zoom
      </div>
      {attribution && <div style={{ ...noteStyle, bottom: 6, left: 6, fontSize: 10 }}>Google · {attribution}</div>}
    </div>
  );
}

const noteStyle: CSSProperties = {
  position: "absolute",
  maxWidth: "calc(100% - 20px)",
  padding: "4px 8px",
  background: "rgba(15, 23, 42, 0.8)",
  color: "#94a3b8",
  fontSize: 11,
  pointerEvents: "none",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

// `visibility` and `transform` are set every frame by the scene.
function tagStyle(selected: boolean): CSSProperties {
  return {
    position: "absolute",
    left: 0,
    top: 0,
    visibility: "hidden",
    pointerEvents: "auto",
    cursor: "pointer",
    height: 18,
    padding: "0 4px",
    font: "600 10px/1 'SF Mono', monospace",
    color: "#fff",
    background: selected ? "#3b82f6" : "rgba(15, 23, 42, 0.85)",
    border: selected ? "2px solid #fff" : "1px solid rgba(255, 255, 255, 0.7)",
    zIndex: selected ? 1 : 0,
    willChange: "transform",
  };
}
