import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PicnicTable } from "./types";
import tables from "virtual:tables";
import { tableSlug } from "./lib/utils";
import GlobalBar, { type Section } from "./components/GlobalBar";
import GridPanel, { type MobileView, type Order } from "./components/GridPanel";
import About from "./components/About";
import Stage from "./components/Stage";
import SeasonTicker from "./components/SeasonTicker";

function readHash() {
  return window.location.hash.match(/^#table-(.+)$/)?.[1] ?? null;
}

const placed = (t: PicnicTable) => t.longitude != null && t.latitude != null;

export default function App() {
  const [section, setSection] = useState<Section>("archive");
  const [order, setOrder] = useState<Order>("number");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("grid");
  // The open table lives in the address (#table-7), so Back, refresh and links work.
  const [slug, setSlug] = useState(readHash);

  useEffect(() => {
    const onHash = () => setSlug(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const sorted = useMemo(
    () => (order === "number" ? tables : [...tables].sort((a, b) => (b.longitude ?? -180) - (a.longitude ?? -180))),
    [order],
  );
  const onMap = useMemo(() => sorted.filter(placed), [sorted]);
  const open = onMap.find((t) => tableSlug(t) === slug) ?? null;

  const openRef = useRef(open);
  openRef.current = open;

  const openTable = useCallback((t: PicnicTable) => {
    if (!placed(t)) return;
    const next = tableSlug(t);
    const url = `#table-${next}`;
    if (openRef.current) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
    setHoveredId(null);
    setSlug(next);
  }, []);

  const close = useCallback(() => {
    if (!openRef.current) return;
    history.pushState(null, "", window.location.pathname + window.location.search);
    setSlug(null);
  }, []);

  const step = useCallback(
    (dir: -1 | 1) => {
      const current = openRef.current;
      if (!current) return;
      const i = onMap.findIndex((t) => t.id === current.id);
      openTable(onMap[(i + dir + onMap.length) % onMap.length]);
    },
    [onMap, openTable],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!openRef.current || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close, step]);

  const chooseSection = (s: Section) => {
    close();
    setSection(s);
  };

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      <GlobalBar section={section} onSection={chooseSection} />
      <SeasonTicker />
      <Stage
        tables={onMap}
        open={open}
        hoveredId={hoveredId}
        onHover={setHoveredId}
        onOpen={openTable}
        onClose={close}
        onStep={step}
        mobileView={mobileView}
        onMobileView={setMobileView}
      >
        {section === "about" ? (
          <About />
        ) : (
          <GridPanel
            tables={sorted}
            order={order}
            onOrder={setOrder}
            hoveredId={hoveredId}
            onHover={setHoveredId}
            onOpen={openTable}
            mobileView={mobileView}
            onMobileView={setMobileView}
          />
        )}
      </Stage>
    </div>
  );
}
