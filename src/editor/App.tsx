import { useEffect, useState, useCallback, useMemo } from "react";
import MapView from "./components/MapView";
import TablePanel from "./components/TablePanel";
import { fetchTables, updateTable } from "./lib/api";
import type { PicnicTable, UpdateTablePayload } from "../types";

export default function App() {
  const [tables, setTables] = useState<PicnicTable[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  useEffect(() => {
    fetchTables().then(setTables);
  }, []);

  const selectedTable = useMemo(
    () => tables.find((t) => t.id === selectedId) ?? null,
    [tables, selectedId]
  );

  const handleMapClick = useCallback(
    async (lng: number, lat: number) => {
      if (selectedId == null) return;
      const updated = await updateTable(selectedId, {
        longitude: lng,
        latitude: lat,
      });
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    },
    [selectedId]
  );

  const handleLiveChange = useCallback(
    (updates: UpdateTablePayload) => {
      if (selectedId == null) return;
      setTables((prev) =>
        prev.map((t) => (t.id === selectedId ? { ...t, ...updates } : t))
      );
    },
    [selectedId]
  );

  const handleCommit = useCallback(
    async (updates: UpdateTablePayload) => {
      if (selectedId == null) return;
      setTables((prev) =>
        prev.map((t) => (t.id === selectedId ? { ...t, ...updates } : t))
      );
      const updated = await updateTable(selectedId, updates);
      setTables((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    },
    [selectedId]
  );

  const isPlaced = selectedTable?.longitude != null;

  return (
    <div style={{ display: "flex", height: "100vh", width: "100vw" }}>
      <TablePanel
        tables={tables}
        selectedId={selectedId}
        onSelect={setSelectedId}
        onLiveChange={handleLiveChange}
        onCommit={handleCommit}
      />
      <div style={{ flex: 1, position: "relative" }}>
        <MapView
          tables={tables}
          selectedId={selectedId}
          onMapClick={handleMapClick}
          onSelectTable={setSelectedId}
        />
        {selectedId != null && !isPlaced && (
          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              background: "rgba(15, 23, 42, 0.85)",
              color: "#94a3b8",
              padding: "6px 16px",
              borderRadius: 6,
              fontSize: 12,
              fontFamily: "'SF Mono', monospace",
              backdropFilter: "blur(8px)",
              pointerEvents: "none",
              zIndex: 3,
            }}
          >
            Click the map to place{" "}
            <strong style={{ color: "#e2e8f0" }}>
              {selectedTable?.name}
            </strong>
          </div>
        )}
      </div>
    </div>
  );
}
