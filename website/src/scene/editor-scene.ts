import { Deck, MapView, WebMercatorViewport, type Layer, type MapViewState } from "deck.gl";
import type { PicnicTable } from "../types";
import {
  GROUND,
  ORIGIN,
  altitudeOf,
  flatLight,
  groundAround,
  isPlaced,
  lookAtTable,
  mixViewStates,
  pickTiles,
  tableIdOfLayer,
  tableLayers,
  tableZ,
  tagProjector,
  tilesLayer,
  viewStateFor,
} from "./deck-world";
import { positionTags } from "./tags";

/** A placement carries the ground's height there (as an altitude above
 *  GROUND), or null when there were no tiles to measure it from. */
export type EditorPick =
  | { type: "select"; id: number }
  | { type: "place"; lat: number; lon: number; altitude: number | null };

const ease = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * The placement editor's map: the same deck.gl layers the site draws, so a
 * table set here stands in the same place there. A click on another table's
 * scan selects it; a click anywhere else places the selected table there,
 * standing on the ground at that spot.
 */
export class EditorScene {
  private deck: Deck<MapView>;
  private viewState: MapViewState;
  private tables: PicnicTable[] = [];
  private byId = new Map<number, PicnicTable>();
  private tiles: Layer | null;
  private selectedId: number | null = null;
  private tags = new Map<number, HTMLElement>();
  private tween: { from: MapViewState; to: MapViewState; start: number } | null = null;
  private down: { x: number; y: number; t: number } | null = null;
  private raf = 0;
  private disposed = false;

  onPick: ((pick: EditorPick) => void) | null = null;
  onAttributions: ((text: string) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    apiKey: string | null,
  ) {
    const box = container.getBoundingClientRect();
    this.viewState = viewStateFor(
      { lon: ORIGIN.lon, lat: ORIGIN.lat, z: GROUND, heading: -20, elevation: 55, distance: 260 },
      box.height,
    );
    // Pickable, so the ground's depth can be read from it.
    // Google's own model of each table stays visible here: it is what the scans are lined up against.
    this.tiles = apiKey ? tilesLayer(apiKey, (text) => this.onAttributions?.(text), true) : null;
    this.deck = new Deck<MapView>({
      canvas,
      width: "100%",
      height: "100%",
      views: new MapView({
        id: "main",
        controller: { dragRotate: true, touchRotate: true, inertia: 250 },
        clear: true,
        clearColor: [26, 27, 30, 255],
      }),
      viewState: this.viewState,
      layers: this.layers(),
      effects: [flatLight],
      onViewStateChange: ({ viewState }) => {
        this.tween = null;
        this.viewState = viewState as MapViewState;
        this.deck.setProps({ viewState: this.viewState });
        return viewState;
      },
      getCursor: ({ isDragging }) => (isDragging ? "grabbing" : "crosshair"),
    });
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    this.raf = requestAnimationFrame(this.loop);
  }

  setTables(tables: PicnicTable[]) {
    this.tables = tables;
    this.byId = new Map(tables.filter(isPlaced).map((t) => [t.id, t]));
    this.deck.setProps({ layers: this.layers() });
  }

  /** Select a table and come in close enough to place it, unless already near
   *  it with it in the middle of the view. */
  setSelected(id: number | null) {
    this.selectedId = id;
    const t = id != null ? this.byId.get(id) : undefined;
    if (!t) return;
    const { width, height } = this.container.getBoundingClientRect();
    const p = tagProjector(this.viewState, width, height)(t);
    const centered = !!p && Math.abs(p[0] / width - 0.5) < 0.3 && Math.abs(p[1] / height - 0.5) < 0.3;
    if (centered && this.viewState.zoom >= 20) return;
    this.tween = {
      from: this.viewState,
      // Low and close, under the canopy that several tables stand beneath.
      to: viewStateFor(lookAtTable(t, this.viewState.bearing ?? 0, 30, 14), height),
      start: performance.now(),
    };
  }

  /** The altitude that would stand a table on the ground it is over, measured
   *  from what the camera sees now; null if too little of that ground is in view. */
  groundUnder(t: PicnicTable): number | null {
    if (!this.tiles || !isPlaced(t)) return null;
    const { width, height } = this.container.getBoundingClientRect();
    const ground = groundAround(this.deck, this.viewState, width, height, t.longitude!, t.latitude!, tableZ(t));
    return ground == null ? null : altitudeOf(ground);
  }

  setTag(id: number, el: HTMLElement | null) {
    if (el) this.tags.set(id, el);
    else this.tags.delete(id);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.deck.finalize();
  }

  private layers() {
    return [...(this.tiles ? [this.tiles] : []), ...tableLayers(this.tables, true)];
  }

  // ---- clicks (a press that barely moved, as opposed to a drag)

  private onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
  };

  private onPointerUp = (e: PointerEvent) => {
    const d = this.down;
    this.down = null;
    if (!d || e.button !== 0) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 500) return;
    const r = this.canvas.getBoundingClientRect();
    this.click(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  };

  private click(x: number, y: number, width: number, height: number) {
    const scanIds = this.tables.filter(isPlaced).map((t) => `table-${t.id}`);
    const id = tableIdOfLayer(this.deck.pickObject({ x, y, radius: 2, layerIds: scanIds })?.layer?.id);
    if (id != null && id !== this.selectedId) {
      this.onPick?.({ type: "select", id });
      return;
    }
    const hit = this.tiles ? pickTiles(this.deck, x, y) : null;
    if (hit) {
      const [lon, lat, z] = hit;
      const ground = groundAround(this.deck, this.viewState, width, height, lon, lat, z) ?? z;
      this.onPick?.({ type: "place", lon, lat, altitude: altitudeOf(ground) });
      return;
    }
    // No tiles under the cursor (or no key): place on the meadow's level.
    const vp = new WebMercatorViewport({ ...this.viewState, width, height });
    const [lon, lat] = vp.unproject([x, y], { targetZ: GROUND });
    this.onPick?.({ type: "place", lon, lat, altitude: null });
  }

  // ---- frame

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    if (this.tween) {
      const t = Math.min(1, (now - this.tween.start) / 800);
      this.viewState = mixViewStates(this.tween.from, this.tween.to, ease(t));
      if (t >= 1) this.tween = null;
      this.deck.setProps({ viewState: this.viewState });
    }
    const box = this.container.getBoundingClientRect();
    const project = tagProjector(this.viewState, box.width, box.height);
    positionTags(
      this.tags,
      (id) => {
        const t = this.byId.get(id);
        return t ? project(t) : null;
      },
      box,
    );
  };
}
