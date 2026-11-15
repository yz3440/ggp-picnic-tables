import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PicnicTable } from "./types";
import tables from "virtual:tables";
import { tableSlug } from "./lib/utils";
import GlobalBar, { type Section } from "./components/GlobalBar";
import GridPanel, { type MobileView, type Order } from "./components/GridPanel";
import About from "./components/About";
import Stage from "./components/Stage";
import SeasonTicker from "./components/SeasonTicker";
import Grass from "./components/Grass";

function readHash() {
  return window.location.hash.match(/^#table-(.+)$/)?.[1] ?? null;
}

/** About is its own page, at /about; everything else is the archive. */
const ABOUT_PATH = "/about";
function readSection(): Section {
  return window.location.pathname.replace(/\/+$/, "") === ABOUT_PATH ? "about" : "archive";
}
const TITLE = "Golden Gate Park Picnic Tables";

const placed = (t: PicnicTable) => t.longitude != null && t.latitude != null;

export default function App() {
  const [section, setSection] = useState<Section>(readSection);
  const [order, setOrder] = useState<Order>("number");
  const [hoveredId, setHoveredId] = useState<number | null>(null);
  const [mobileView, setMobileView] = useState<MobileView>("grid");
  // The open table lives in the address (#table-7), so Back, refresh and links work.
  const [slug, setSlug] = useState(readHash);

  useEffect(() => {
    const onHash = () => setSlug(readHash());
    // Back and Forward between the archive and About change the path, not the hash.
    const onPop = () => {
      setSection(readSection());
      setSlug(readHash());
    };
    window.addEventListener("hashchange", onHash);
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("hashchange", onHash);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  useEffect(() => {
    document.title = section === "about" ? `About · ${TITLE}` : TITLE;
  }, [section]);

  const sorted = useMemo(
    () => (order === "number" ? tables : [...tables].sort((a, b) => (b.longitude ?? -180) - (a.longitude ?? -180))),
    [order],
  );
  const onMap = useMemo(() => sorted.filter(placed), [sorted]);
  const open = section === "archive" ? (onMap.find((t) => tableSlug(t) === slug) ?? null) : null;

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
    if (s === section && !openRef.current) return;
    history.pushState(null, "", s === "about" ? ABOUT_PATH : "/");
    setSlug(null);
    setSection(s);
  };

  return (
    // No background of its own: the body's paper color, with the grass over it, shows through.
    <div className="flex h-dvh flex-col overflow-hidden text-foreground">
      <Grass />
      <GlobalBar section={section} onSection={chooseSection} />
      <SeasonTicker />
      {section === "about" && (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <About />
        </main>
      )}
      {/* The archive stays mounted under About, hidden, so its map and 3D scene
          are where they were on the way back. */}
      <div className={`flex min-h-0 flex-1 flex-col ${section === "about" ? "hidden" : ""}`}>
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
        </Stage>
      </div>
    </div>
  );
}
