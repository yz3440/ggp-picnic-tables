import { memo, useEffect, useRef, useState } from "react";
import type { PicnicTable } from "../types";
import { formatCoords, previewUrl, tableTitle } from "../lib/utils";

interface TableCardProps {
  table: PicnicTable;
  index: number;
  /** Its tag on the map is hovered. */
  linked: boolean;
  onHover: (id: number | null) => void;
  onOpen: (table: PicnicTable) => void;
}

/**
 * The render on its black plate, the caption beneath. Grayscale until hovered or linked from the
 * map; hovering plays the orbit render.
 *
 * The card uses small versions of the renders (scripts/make-previews.ts). Its
 * video starts loading as the card comes into view, so it is ready by the
 * time it is hovered, and only shows once it is actually playing.
 */
const TableCard = memo(function TableCard({ table, index, linked, onHover, onOpen }: TableCardProps) {
  const cardRef = useRef<HTMLButtonElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hovering, setHovering] = useState(false);
  /** The video has been asked for (the card came into view, or was hovered). */
  const [warm, setWarm] = useState(false);
  const [playing, setPlaying] = useState(false);
  const active = hovering || linked;

  useEffect(() => {
    const el = cardRef.current;
    if (!el || warm) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setWarm(true);
          io.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [warm]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v || !warm) return;
    if (hovering) {
      v.play().catch(() => {});
    } else {
      v.pause();
      setPlaying(false);
      if (v.currentTime > 0) v.currentTime = 0;
    }
  }, [hovering, warm]);

  const enter = () => {
    setWarm(true);
    setHovering(true);
    onHover(table.id);
  };
  const leave = () => {
    setHovering(false);
    onHover(null);
  };

  return (
    <button
      ref={cardRef}
      type="button"
      data-table-id={table.id}
      onMouseEnter={enter}
      onMouseLeave={leave}
      onFocus={enter}
      onBlur={leave}
      onClick={() => {
        // The card goes inert under the viewer and never hears mouseleave.
        leave();
        onOpen(table);
      }}
      className="group animate-card-enter cursor-pointer text-left outline-none"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div
        data-plate
        className="relative aspect-square overflow-hidden bg-plate outline-offset-2 group-focus-visible:outline group-focus-visible:outline-1 group-focus-visible:outline-ring"
      >
        <img
          src={previewUrl(table, "jpg")}
          alt=""
          loading="lazy"
          draggable={false}
          className={`absolute inset-0 size-full scale-[1.35] object-cover transition-[filter] duration-500 ${active ? "" : "brightness-90 grayscale"}`}
        />
        <video
          ref={videoRef}
          src={warm ? previewUrl(table, "mp4") : undefined}
          muted
          loop
          playsInline
          preload={warm ? "auto" : "none"}
          onPlaying={() => setPlaying(true)}
          className={`pointer-events-none absolute inset-0 size-full scale-[1.35] object-cover transition-opacity duration-300 ${hovering && playing ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <span className="mt-2 block text-[13px] font-bold underline decoration-control underline-offset-2 group-hover:decoration-foreground">
        {tableTitle(table)}
      </span>
      <span className="block truncate text-[11px] text-muted-foreground" title={formatCoords(table)}>
        {table.file}
      </span>
    </button>
  );
});

export default TableCard;
