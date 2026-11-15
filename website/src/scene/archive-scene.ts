import { Deck, MapView, type Layer, type MapViewState } from "deck.gl";
import type { PicnicTable } from "../types";
import {
  BASEMAP_ID,
  ORIGIN,
  GROUND,
  GROUND_MAP_ID,
  basemapLayer,
  loadTerrain,
  TERRAIN_ID,
  createMapSession,
  flatLight,
  hexToRgba,
  isPlaced,
  lookAtTable,
  mapCopyright,
  mapFocus,
  mapOverview,
  mixViewStates,
  renderView,
  tableGround,
  tableIdOfLayer,
  tableZ,
  type MapKind,
  tableLayers,
  tableRadius,
  tagProjector,
  tilesLayer,
  viewStateFor,
} from "./deck-world";
import { layoutCallouts } from "./tags";
import { CarveExtension, carveBoxes, carveFloorLayer } from "./carve";
import { ParkLightExtension } from "./park-light";
import { glowLayer, glowSize, glowStrength } from "./glow";
import { SeeThroughExtension, type SeeThrough } from "./see-through";

export type ViewPreset = "orbit" | "top" | "side";
/** What the open table stands on: the baked lidar ground with an aerial photo
 *  (no Google), Google's satellite imagery laid flat, or Google's 3D tiles. */
export type Ground = "terrain" | "satellite" | "3d";
type ViewId = "viewer" | "map";

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Tween {
  from: MapViewState;
  to: MapViewState;
  start: number;
  ms: number;
}

/** The loupe magnifies four times (two zoom steps) around the point under the pointer. */
const LOUPE_ZOOM = 2;
const MAX_LOUPE_ZOOM = 29;

/** The viewer's field of view, in degrees (deck's own default is about 37). */
const VIEWER_FOVY = 12;
// How far out the viewer may zoom (each zoom step halves the distance; with
// the viewer about 800 px tall, zoom 12.2 shows about 11 km, San Francisco,
// and zoom 10.2 about 45 km: the city and the Peninsula).
/** Past this, a warning says that zooming out further will leave the table. */
const WARN_ZOOM = 10.6;
/** Past this, the table closes back to the overview. */
const LEAVE_ZOOM = 9.8;
/** The viewer cannot zoom out further than this. */
const MIN_VIEWER_ZOOM = 9.5;
/** Degrees per millisecond when the table turns by itself. */
// Negative: the camera goes round counterclockwise, seen from above.
const SPIN = -0.008;
const ease = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

// The move after opening a table from the grid: from the render's view
// straight down, pull back and tilt down while starting to circle the table.
/** Wait for the render's still to fade into the 3D view (see Stage). */
const INTRO_DELAY = 1250;
/** Going from one open table to another: the flight to its render's view, and
 *  the pause before the same move begins. */
const SWITCH_MS = 900;
/** Start the move anyway if the table's model has not loaded by then. */
const MODEL_WAIT_MAX = 12000;
const SWITCH_PAUSE = 150;
/** How long the pull-back and tilt take. */
const INTRO_MS = 2600;
/** How far it pulls back (each zoom step doubles the distance). */
const INTRO_ZOOM_OUT = 0.8;
/** How far it tilts: deck's pitch, 0 straight down, 90 level. */
const INTRO_PITCH = 52;
/** The turn eases in over this long, up to SPIN. */
const INTRO_SPIN_RAMP = 1800;
const sameBox = (a: Box | null, b: Box | null) =>
  a === b || (!!a && !!b && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/**
 * One deck.gl canvas with two MapViews: the table viewer (Google's 3D tiles
 * with the scans standing in them) and the map (a flat, pale Google roadmap
 * with the tags over it). Each view is placed on the rectangle its DOM element occupies,
 * read every frame, so CSS decides where the views are and how they move
 * between states. The canvas is clipped to those rectangles so the page
 * around them stays clickable.
 */
export class ArchiveScene {
  private deck: Deck<MapView[]>;
  private tables: PicnicTable[];
  private byId: Map<number, PicnicTable>;
  private els: Record<ViewId, HTMLElement>;
  private viewStates: Record<ViewId, MapViewState>;
  private rects: Record<ViewId, Box | null> = { viewer: null, map: null };
  private colors: Record<ViewId, number[]> = { viewer: [0, 0, 0, 255], map: [245, 245, 245, 255] };
  private tweens: Partial<Record<ViewId, Tween>> = {};
  private tags = new Map<number, HTMLElement>();
  private calloutLayer: SVGSVGElement | null = null;
  /** The loupe: a third view, over the viewer's bottom-left corner, that
   *  draws only the scans, magnified around the point under the pointer. */
  private loupeEl: HTMLElement | null = null;
  private loupeRect: Box | null = null;
  /** The point on a scan under the pointer, [lon, lat, z], or null. */
  private loupeAt: number[] | null = null;
  /** The pointer over the canvas, in its pixels; picked at most once a frame. */
  private pointer: { x: number; y: number } | null = null;
  private pointerDirty = false;
  private apiKey: string | null;
  private tiles: Layer | null = null;
  private floors: Layer | null = null;
  private scans: Layer[] = [];
  private basemap: Layer | null = null;
  private groundMap: Layer | null = null;
  /** The baked terrain by default; satellite and the 3D tiles are the alternatives. */
  private ground: Ground = "terrain";
  /** The baked ground, once loaded (model/ground/, scripts/build-ground.ts). */
  private terrain: Layer[] = [];
  private terrainLoading: Promise<void> | null = null;
  /** The satellite session, once made: the viewer's imagery is requested with it. */
  private satellite: string | null = null;
  private mapDark: boolean | null = null;
  /** Where the viewer looks while a table is open. Set by the scene's own
   *  camera moves; the visitor can orbit and zoom around it but not move it. */
  private anchor: Pick<MapViewState, "longitude" | "latitude" | "position"> | null = null;
  private zoomedOut = false;
  /** The opening move, while it runs. */
  private intro: {
    from: MapViewState;
    /** When the move starts: unknown (Infinity) until the table's model has loaded. */
    start: number;
    /** Not before this, */
    earliest: number;
    /** and this long after the model has loaded. */
    afterReady: number;
  } | null = null;
  /** The open table whose model has loaded, and when the table was opened. */
  private readyId: number | null = null;
  private openedAt = 0;
  private seeThrough: SeeThrough = { active: false, boxes: [] };
  private warned = false;
  private glow: Layer | null = null;
  private glowKey = "";
  private sessions: Partial<Record<MapKind, Promise<string>>> = {};
  private openId: number | null = null;
  private autoRotate = false;
  private needsOverview = true;
  /** The map pane's size while the grid is showing. */
  private gridSize: { width: number; height: number } | null = null;
  private raf = 0;
  private lastTime = 0;
  private lastViewer: MapViewState | null = null;
  private disposed = false;

  /** Credits for the 3D tiles in the viewer. */
  onAttributions: ((text: string) => void) | null = null;
  /** Credits for the map ("Map data ©… Google"). */
  onMapAttributions: ((text: string) => void) | null = null;
  /** Credits for the viewer's satellite imagery ("Imagery ©… Airbus, …"). */
  onSatelliteAttributions: ((text: string) => void) | null = null;
  /** The visitor zoomed out past the limit: close the table. */
  onZoomOut: (() => void) | null = null;
  /** Whether to show the warning that zooming out further leaves the table. */
  onZoomWarning: ((warn: boolean) => void) | null = null;
  /** The scene started or stopped turning the table by itself (the opening
   *  move hands over to turning; taking hold of the camera stops it). */
  onAutoRotate: ((on: boolean) => void) | null = null;
  /** Another table's scan was clicked in the viewer. */
  onPickTable: ((id: number) => void) | null = null;
  /** The open table's model has loaded. */
  onModelReady: ((id: number) => void) | null = null;
  /** The baked ground's credits, once it has loaded. */
  onTerrainCredit: ((text: string) => void) | null = null;
  /** The loupe appeared or went away. */
  onLoupe: ((on: boolean) => void) | null = null;

  constructor(
    private container: HTMLElement,
    private canvas: HTMLCanvasElement,
    mapEl: HTMLElement,
    viewerEl: HTMLElement,
    tables: PicnicTable[],
    apiKey: string | null,
  ) {
    this.apiKey = apiKey;
    this.tables = tables.filter(isPlaced);
    this.byId = new Map(this.tables.map((t) => [t.id, t]));
    this.els = { viewer: viewerEl, map: mapEl };
    const box = container.getBoundingClientRect();
    const first = this.tables[0];
    this.viewStates = {
      viewer: first
        ? viewStateFor(lookAtTable(first, 160, 30, 6), box.height)
        : viewStateFor({ lon: ORIGIN.lon, lat: ORIGIN.lat, z: GROUND, heading: 0, elevation: 30, distance: 10 }, box.height),
      map: mapOverview(this.tables, box.width * 0.45, box.height),
    };

    this.deck = new Deck<MapView[]>({
      canvas,
      width: "100%",
      height: "100%",
      views: [],
      viewState: this.deckViewState(),
      layers: [],
      // The map shows only the roadmap; the loupe the scans, and the baked
      // ground (one small mesh, unlike the streamed tiles); everything else is the viewer's.
      layerFilter: ({ layer, viewport }) =>
        viewport.id === "loupe"
          ? tableIdOfLayer(layer.id) != null || layer.id === TERRAIN_ID
          : (viewport.id === "map") === layer.id.startsWith(BASEMAP_ID),
      onHover: (info) => this.setPointer(info.viewport?.id === "viewer" && info.x >= 0 ? { x: info.x, y: info.y } : null),
      // No loupe while the camera is being turned.
      onDragStart: () => this.setPointer(null),
      effects: [flatLight],
      onViewStateChange: ({ viewId, viewState, interactionState }) => {
        const id = viewId as ViewId;
        // The visitor took hold of the camera: stop any flight on that view.
        if (interactionState.isDragging || interactionState.isZooming || interactionState.isPanning || interactionState.isRotating) {
          delete this.tweens[id];
          if (id === "viewer" && this.intro) this.stopIntro();
        }
        let state = viewState as MapViewState;
        if (id === "viewer" && this.openId != null && this.anchor) {
          // Orbit and zoom only: the table stays where it is in the view.
          state = { ...state, ...this.anchor, minZoom: MIN_VIEWER_ZOOM };
          this.setWarning(state.zoom < WARN_ZOOM);
          if (state.zoom < LEAVE_ZOOM && !this.zoomedOut) {
            this.zoomedOut = true;
            this.onZoomOut?.();
          }
        }
        this.setViewState(id, state);
        return state as typeof viewState;
      },
      getCursor: ({ isDragging, isHovering }) => (isDragging ? "grabbing" : isHovering ? "pointer" : "grab"),
      // Click a scan in the viewer to go to that table.
      onClick: (info) => {
        if (info.viewport?.id !== "viewer" || this.openId == null) return;
        const id = tableIdOfLayer(info.layer?.id);
        if (id != null && id !== this.openId) this.onPickTable?.(id);
      },
    });
    // Cut Google's model of each table from under its scan, dim the tiles and
    // light up the park.
    const boxes = carveBoxes(this.tables);
    this.seeThrough.boxes = boxes;
    const carve = {
      extensions: [new CarveExtension(), new ParkLightExtension(), new SeeThroughExtension()],
      carveBoxes: boxes,
      // Trees and roofs between the camera and each table turn see-through.
      seeThrough: this.seeThrough,
    };
    if (apiKey) {
      // Detail only around the tables; the rest of the city as coarse as it can be.
      const around = this.tables.map((t) => [t.longitude!, t.latitude!, tableZ(t)]);
      this.tiles = tilesLayer(apiKey, (text) => this.onAttributions?.(text), false, carve, around);
      this.floors = carveFloorLayer(boxes);
    }
    this.scans = tableLayers(this.tables, true);
    this.updateLayers();
    // No view is placed yet: let the page under the canvas take every event.
    this.clipCanvas();
    this.raf = requestAnimationFrame(this.loop);
    this.canvas.addEventListener("pointerleave", this.onLeave);
  }

  private onLeave = () => this.setPointer(null);

  // ---- public

  setColors(map: string, viewer: string) {
    this.colors = { map: hexToRgba(map), viewer: hexToRgba(viewer) };
    this.deck.setProps({ views: this.buildViews() });
  }

  /** Light or dark roadmap, to match the page. */
  setMapStyle(dark: boolean) {
    const apiKey = this.apiKey;
    if (!apiKey || dark === this.mapDark) return;
    this.mapDark = dark;
    const key = dark ? "dark" : "light";
    const session = (this.sessions[key] ??= createMapSession(apiKey, key));
    session
      .then(async (s) => {
        if (this.disposed || this.mapDark !== dark) return;
        this.basemap = basemapLayer(apiKey, s, key);
        this.updateLayers();
        this.onMapAttributions?.(await mapCopyright(apiKey, s, this.tables));
      })
      .catch((e) => console.error(e));
  }

  /** Stand the open table on the satellite imagery or on the 3D tiles. */
  setGround(ground: Ground) {
    if (ground === this.ground) return;
    this.ground = ground;
    this.updateGroundMap();
    this.ensureSatellite();
    this.ensureTerrain();
    this.updateLayers();
    this.deck.setProps({ views: this.buildViews() });
  }

  setTag(id: number, el: HTMLElement | null) {
    if (el) this.tags.set(id, el);
    else this.tags.delete(id);
  }

  /** The box the loupe draws into (its size and place come from CSS). */
  setLoupe(el: HTMLElement | null) {
    this.loupeEl = el;
  }

  /** The SVG over the map that the tags' dots and leader lines are drawn into. */
  setCalloutLayer(layer: SVGSVGElement | null) {
    this.calloutLayer = layer;
  }

  /** Open a table (or null for the grid). The map follows; the viewer flies in. */
  setOpen(id: number | null) {
    if (id === this.openId) return;
    const previous = this.openId;
    this.openId = id;
    this.autoRotate = false;
    this.intro = null;
    this.zoomedOut = false;
    this.setWarning(false);
    this.seeThrough.active = id != null;
    this.readyId = null;
    this.openedAt = performance.now();
    if (id == null) {
      this.anchor = null;
      const size = this.gridSize ?? { width: 640, height: 836 };
      this.fly("map", mapOverview(this.tables, size.width, size.height), 900);
      return;
    }
    const t = this.byId.get(id);
    if (!t) return;
    // Open on the card's own picture: straight down, turned and framed as the
    // render is, so the still fades into the 3D view without a jump.
    // From another table, fly there first; either way, then the opening move.
    const opening = this.openingState(t);
    const moving = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (previous == null) {
      this.jump("viewer", opening);
      if (moving) this.intro = { from: opening, start: Infinity, earliest: performance.now() + INTRO_DELAY, afterReady: INTRO_DELAY };
    } else {
      this.fly("viewer", opening, SWITCH_MS);
      if (moving) {
        const wait = SWITCH_MS + SWITCH_PAUSE;
        this.intro = { from: opening, start: Infinity, earliest: performance.now() + wait, afterReady: SWITCH_PAUSE };
      }
    }
    this.fly("map", mapFocus(t), 900);
    this.ensureSatellite();
    this.ensureTerrain();
    this.updateGroundMap();
    this.updateLayers();
  }

  setPreset(preset: ViewPreset) {
    this.intro = null;
    const t = this.openId != null ? this.byId.get(this.openId) : undefined;
    if (t) this.fly("viewer", this.presetState(t, preset, this.viewStates.viewer.bearing ?? 160), 700);
  }

  setAutoRotate(on: boolean) {
    this.autoRotate = on;
    if (!on) this.intro = null;
  }

  resetView() {
    this.intro = null;
    const t = this.openId != null ? this.byId.get(this.openId) : undefined;
    if (t) this.fly("viewer", this.openingState(t), 700);
  }

  dispose() {
    this.canvas.removeEventListener("pointerleave", this.onLeave);
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.deck.finalize();
  }

  // ---- layers and views

  private updateLayers() {
    const on3d = this.ground === "3d";
    // Hidden, not removed, so their tiles stay loaded for switching back.
    const hide = (layer: Layer | null, visible: boolean) => (layer ? [layer.clone({ visible })] : []);
    this.deck.setProps({
      layers: [
        ...(this.basemap ? [this.basemap] : []),
        ...hide(this.tiles, on3d),
        ...hide(this.floors, on3d),
        ...this.terrain.flatMap((layer) => hide(layer, this.ground === "terrain")),
        ...(this.ground === "satellite" && this.groundMap ? [this.groundMap] : []),
        // The glow before the scans: a halo behind each table, which the scan
        // covers wherever it can be seen, and which shows through trees where
        // it cannot.
        ...(this.glow ? [this.glow] : []),
        ...this.scans,
      ],
    });
  }

  private setWarning(warn: boolean) {
    if (warn === this.warned) return;
    this.warned = warn;
    this.onZoomWarning?.(warn);
  }

  /** Brighter the further out the viewer is; rebuilt only when it changes. */
  private updateGlow(zoom: number) {
    const level = Math.round(glowStrength(zoom) * 50) / 50;
    const size = glowSize(zoom);
    const key = `${level}/${size}`;
    if (key === this.glowKey && this.glow) return;
    this.glowKey = key;
    this.glow = glowLayer(this.tables, level, size);
    this.updateLayers();
  }

  /** Load the baked ground the first time it is wanted. */
  private ensureTerrain() {
    if (this.ground !== "terrain" || this.terrainLoading) return;
    this.terrainLoading = loadTerrain(this.tables)
      .then(({ layers, credit }) => {
        if (this.disposed) return;
        this.terrain = layers;
        this.onTerrainCredit?.(credit);
        this.updateLayers();
      })
      .catch((e) => {
        console.error(e);
        this.terrainLoading = null;
      });
  }

  /** Make the satellite session the first time the imagery is wanted. */
  private ensureSatellite() {
    const apiKey = this.apiKey;
    if (!apiKey || this.ground !== "satellite" || this.sessions.satellite) return;
    this.sessions.satellite = createMapSession(apiKey, "satellite");
    this.sessions.satellite
      .then(async (s) => {
        if (this.disposed) return;
        this.satellite = s;
        this.updateGroundMap();
        this.updateLayers();
        // Imagery credits depend on the zoom; ask at the zoom the viewer opens close to.
        this.onSatelliteAttributions?.(await mapCopyright(apiKey, s, this.tables, 20));
      })
      .catch((e) => console.error(e));
  }

  /** The viewer's satellite imagery, laid at the open table's ground. */
  private updateGroundMap() {
    const t = this.openId != null ? this.byId.get(this.openId) : undefined;
    if (!this.apiKey || !this.satellite || !t) return;
    this.groundMap = basemapLayer(this.apiKey, this.satellite, "satellite", {
      idPrefix: GROUND_MAP_ID,
      z: tableGround(t) - 0.02,
    });
  }

  /** Viewer first, then the loupe over its corner; the minimap sits on top of both, so it is drawn last. */
  private buildViews() {
    const views: MapView[] = [];
    for (const id of ["viewer", "map"] as ViewId[]) {
      const b = this.rects[id];
      if (id === "map" && this.loupeRect) {
        views.push(
          new MapView({
            id: "loupe",
            ...this.loupeRect,
            controller: false,
            clear: true,
            clearColor: this.colors.viewer,
            fovy: VIEWER_FOVY,
          }),
        );
      }
      if (!b) continue;
      views.push(
        new MapView({
          id,
          x: b.x,
          y: b.y,
          width: b.width,
          height: b.height,
          // The map is flat and north up, like a paper map. In the viewer a
          // drag orbits around the table (moving is locked off: see anchor).
          controller:
            id === "map"
              ? { dragRotate: false, touchRotate: false, inertia: 250 }
              : { dragMode: "rotate", dragRotate: true, touchRotate: true, keyboard: false, inertia: 250 },
          clear: true,
          clearColor: this.colors[id],
          // A long lens in the viewer: close to the renders' orthographic
          // camera, so a table top and the pad under it keep their relative
          // sizes when the still fades into the 3D view. (deck sets the scale
          // at the point looked at, so the framing does not change.)
          ...(id === "viewer" && { fovy: VIEWER_FOVY }),
          // Leave nearZMultiplier at deck's default: loaders.gl builds its
          // culling planes from the near plane, and pulled in close to the
          // camera they degenerate and cut holes in the tiles.
        }),
      );
    }
    return views;
  }

  /** Only the views take pointer events; the rest of the canvas lets them through. */
  private clipCanvas() {
    const parts = [this.rects.viewer, this.rects.map]
      .filter((b): b is Box => !!b)
      .map((b) => `M${b.x} ${b.y}h${b.width}v${b.height}h${-b.width}Z`);
    this.canvas.style.clipPath = parts.length ? `path('${parts.join(" ")}')` : "inset(100%)";
  }

  /** The viewer's size once open: the whole stage, less its toolbar and status strip. */
  private openSize() {
    const box = this.container.getBoundingClientRect();
    return { width: Math.max(1, box.width), height: Math.max(1, box.height - 56) };
  }

  /** The table as its render shows it (see renderView). */
  private openingState(t: PicnicTable) {
    const { width, height } = this.openSize();
    return renderView(t, width, height);
  }

  private presetState(t: PicnicTable, preset: ViewPreset, heading: number) {
    if (preset === "top") return this.openingState(t);
    // The open viewer fills the viewport; on a narrow one, stand further back.
    const box = this.container.getBoundingClientRect();
    const height = Math.max(1, box.height - 56);
    const r = tableRadius(t) * Math.max(1, 1 / ((box.width / height) * 1.4));
    const look = preset === "side" ? lookAtTable(t, heading, 6, r * 2.4) : lookAtTable(t, heading, 30, r * 2.6);
    return viewStateFor(look, height);
  }

  private setViewState(id: ViewId, state: MapViewState) {
    this.viewStates = { ...this.viewStates, [id]: state };
    this.deck.setProps({ viewState: this.deckViewState() });
  }

  /** Every view's state for deck; the loupe follows the viewer, closer, onto the point picked. */
  private deckViewState() {
    const viewer = this.viewStates.viewer;
    if (!this.loupeAt) return { ...this.viewStates, loupe: viewer };
    const [longitude, latitude, z] = this.loupeAt;
    const loupe: MapViewState = {
      ...viewer,
      longitude,
      latitude,
      position: [0, 0, z],
      zoom: Math.min(viewer.zoom + LOUPE_ZOOM, MAX_LOUPE_ZOOM),
      minZoom: 0,
      maxZoom: MAX_LOUPE_ZOOM,
    };
    return { ...this.viewStates, loupe };
  }

  private setPointer(p: { x: number; y: number } | null) {
    this.pointer = p;
    this.pointerDirty = true;
  }

  /** The point on a scan under the pointer, read from the depth buffer. Not
   *  over the loupe itself or the minimap, which both sit on the viewer. */
  private pickSurface(): number[] | null {
    const p = this.pointer;
    if (!p || this.openId == null || !this.rects.viewer) return null;
    const inside = (b: Box | null) => !!b && p.x >= b.x && p.y >= b.y && p.x < b.x + b.width && p.y < b.y + b.height;
    if (inside(this.loupeRect) || inside(this.rects.map)) return null;
    const info = this.deck.pickObject({
      x: p.x,
      y: p.y,
      radius: 0,
      layerIds: this.scans.map((l) => l.id),
      unproject3D: true,
    });
    const c = info?.viewport?.id === "viewer" ? info.coordinate : null;
    return c && c.length >= 3 ? c : null;
  }

  /** The opening move `t` ms in: pulling back and tilting down, eased, while
   *  the turn speeds up smoothly to SPIN. */
  private introState(t: number): MapViewState {
    const from = this.intro!.from;
    const k = easeInOut(Math.min(1, t / INTRO_MS));
    const turned = SPIN * (t < INTRO_SPIN_RAMP ? (t * t) / (2 * INTRO_SPIN_RAMP) : t - INTRO_SPIN_RAMP / 2);
    return {
      ...from,
      zoom: from.zoom - INTRO_ZOOM_OUT * k,
      pitch: (from.pitch ?? 0) + (INTRO_PITCH - (from.pitch ?? 0)) * k,
      bearing: (from.bearing ?? 0) + turned,
    };
  }

  /** Has the open table's model loaded? Then the opening move can be timed. */
  private checkModelReady(now: number) {
    const id = this.openId;
    if (id == null || this.readyId === id) return;
    const layer = (this.deck as unknown as { layerManager?: { getLayers(): { id: string; state?: { scenegraph?: unknown } }[] } })
      .layerManager?.getLayers()
      .find((l) => tableIdOfLayer(l.id) === id);
    // Go ahead anyway if a model never arrives.
    if (!layer?.state?.scenegraph && now - this.openedAt < MODEL_WAIT_MAX) return;
    this.readyId = id;
    if (this.intro && this.intro.start === Infinity) {
      this.intro.start = Math.max(this.intro.earliest, now + this.intro.afterReady);
    }
    this.onModelReady?.(id);
  }

  private stopIntro() {
    this.intro = null;
    this.autoRotate = false;
    this.onAutoRotate?.(false);
  }

  /** The scene moved the viewer: what it looks at is the new anchor. */
  private setAnchor(state: MapViewState) {
    if (this.openId == null) return;
    this.anchor = { longitude: state.longitude, latitude: state.latitude, position: state.position };
  }

  private jump(id: ViewId, state: MapViewState) {
    delete this.tweens[id];
    this.setViewState(id, state);
    if (id === "viewer") this.setAnchor(state);
  }

  private fly(id: ViewId, to: MapViewState, ms: number, delay = 0) {
    this.tweens[id] = { from: this.viewStates[id], to, start: performance.now() + delay, ms };
  }

  // ---- frame

  private loop = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = this.lastTime ? now - this.lastTime : 0;
    this.lastTime = now;

    const stage = this.container.getBoundingClientRect();
    let viewsChanged = false;
    for (const id of ["viewer", "map"] as ViewId[]) {
      const el = this.els[id];
      const r = el.getBoundingClientRect();
      const box =
        r.width > 2 && r.height > 2 && el.offsetParent !== null
          ? {
              x: Math.round(r.left - stage.left),
              y: Math.round(r.top - stage.top),
              width: Math.round(r.width),
              height: Math.round(r.height),
            }
          : null;
      if (!sameBox(box, this.rects[id])) {
        this.rects[id] = box;
        viewsChanged = true;
      }
    }
    // The loupe: pick when the pointer or the camera moved, show it while a scan is under the pointer.
    const viewerMoved = this.viewStates.viewer !== this.lastViewer;
    this.lastViewer = this.viewStates.viewer;
    let loupeMoved = false;
    if (this.pointerDirty || (viewerMoved && this.pointer)) {
      this.pointerDirty = false;
      const at = this.pickSurface();
      loupeMoved = at !== this.loupeAt;
      this.loupeAt = at;
    }
    const le = this.loupeEl;
    const lr = le && this.openId != null && this.loupeAt && le.offsetParent !== null ? le.getBoundingClientRect() : null;
    const loupeBox =
      lr && lr.width > 2
        ? { x: Math.round(lr.left - stage.left), y: Math.round(lr.top - stage.top), width: Math.round(lr.width), height: Math.round(lr.height) }
        : null;
    if (!sameBox(loupeBox, this.loupeRect)) {
      if (!loupeBox !== !this.loupeRect) this.onLoupe?.(!!loupeBox);
      this.loupeRect = loupeBox;
      viewsChanged = true;
    }

    if (viewsChanged) {
      this.deck.setProps({ views: this.buildViews() });
      this.clipCanvas();
    }

    let states = this.viewStates;
    const map = this.rects.map;
    if (map && this.openId == null && !this.tweens.map) {
      this.gridSize = { width: map.width, height: map.height };
      // Frame the overview once the map's real shape is known.
      if (this.needsOverview) {
        this.needsOverview = false;
        states = { ...states, map: mapOverview(this.tables, map.width, map.height) };
      }
    }
    for (const id of ["viewer", "map"] as ViewId[]) {
      const tw = this.tweens[id];
      if (!tw || now < tw.start) continue;
      const t = Math.min(1, (now - tw.start) / tw.ms);
      states = { ...states, [id]: mixViewStates(tw.from, tw.to, ease(t)) };
      if (id === "viewer") this.setAnchor(states.viewer);
      if (t >= 1) delete this.tweens[id];
    }
    this.checkModelReady(now);
    if (this.intro && now >= this.intro.start) {
      states = { ...states, viewer: this.introState(now - this.intro.start) };
      if (now - this.intro.start >= INTRO_MS) {
        // Hand over to turning by itself, at the speed the move ended at.
        this.intro = null;
        this.autoRotate = true;
        this.onAutoRotate?.(true);
      }
    } else if (this.autoRotate && this.openId != null && !this.tweens.viewer && !this.intro) {
      states = { ...states, viewer: { ...states.viewer, bearing: (states.viewer.bearing ?? 0) + dt * SPIN } };
    }
    if (states !== this.viewStates || loupeMoved) {
      this.viewStates = states;
      this.deck.setProps({ viewState: this.deckViewState() });
    }
    this.updateGlow(this.openId != null ? this.viewStates.viewer.zoom : 99);

    const project = map ? tagProjector(this.viewStates.map, map.width, map.height, true) : null;
    layoutCallouts(
      this.tags,
      (id) => {
        const t = this.byId.get(id);
        return t && project ? project(t) : null;
      },
      map,
      this.calloutLayer,
    );
  };
}
