import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { PicnicTable } from '../types';
import {
  ArchiveScene,
  type Ground,
  type ViewPreset,
} from '../scene/archive-scene';
import { PARK_CREDIT } from '../scene/park-light';
import {
  formatCoords,
  formatDegrees,
  modelUrl,
  renderUrl,
  tableTag,
  tableTitle,
} from '../lib/utils';
import { MobileToggle, type MobileView } from './GridPanel';
import { Icon } from './Icon';
import { button, MICRO } from './ui';

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY?.trim() || null;

/** closed: the grid. from: the viewer sits on the clicked card's picture. open:
 *  the viewer fills the viewport. closing: it shrinks back onto the card. */
type Phase = 'closed' | 'from' | 'open' | 'closing';
interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GROW_MS = 450;
const VIEWS: { id: ViewPreset; label: string }[] = [
  { id: 'top', label: 'top' },
  { id: 'orbit', label: 'orbit' },
  { id: 'side', label: 'side' },
];

interface StageProps {
  /** The tables on the map, in the order previous / next steps through. */
  tables: PicnicTable[];
  open: PicnicTable | null;
  hoveredId: number | null;
  onHover: (id: number | null) => void;
  onOpen: (table: PicnicTable) => void;
  onClose: () => void;
  onStep: (dir: -1 | 1) => void;
  mobileView: MobileView;
  onMobileView: (v: MobileView) => void;
  /** The left pane. */
  children: ReactNode;
}

/**
 * The viewport under the bar: the tables on the left, the map on the right.
 * Opening a table changes the two panes in place: the clicked card's picture
 * grows into a viewer across the whole viewport and the map pane shrinks into
 * the bottom-right corner. One canvas draws both views (see ArchiveScene).
 */
export default function Stage({
  tables,
  open,
  hoveredId,
  onHover,
  onOpen,
  onClose,
  onStep,
  mobileView,
  onMobileView,
  children,
}: StageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<ArchiveScene | null>(null);
  const tagEls = useRef(new Map<number, HTMLElement>());
  const calloutRef = useRef<SVGSVGElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const [loupeOn, setLoupeOn] = useState(false);

  const [phase, setPhase] = useState<Phase>(open ? 'open' : 'closed');
  const [box, setBox] = useState<Box | null>(null);
  const [shown, setShown] = useState<PicnicTable | null>(open);
  const [autoRotate, setAutoRotate] = useState(false);
  const [preset, setPreset] = useState<ViewPreset>('top');
  const [ground, setGround] = useState<Ground>('satellite');
  /** The open table whose model has loaded, and the table whose render stays
   *  up until then (opening from the grid). */
  const [readyId, setReadyId] = useState<number | null>(null);
  const [holdStill, setHoldStill] = useState<number | null>(null);
  const [zoomWarning, setZoomWarning] = useState(false);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const openRef = useRef({ onOpen, tables });
  openRef.current = { onOpen, tables };
  const [attribution, setAttribution] = useState('');
  const [mapAttribution, setMapAttribution] = useState('');
  const [satelliteAttribution, setSatelliteAttribution] = useState('');
  const [terrainCredit, setTerrainCredit] = useState('');

  // One scene for the life of the page.
  useEffect(() => {
    const scene = new ArchiveScene(
      containerRef.current!,
      canvasRef.current!,
      mapRef.current!,
      viewerRef.current!,
      tables,
      API_KEY,
    );
    scene.onAttributions = setAttribution;
    scene.onMapAttributions = setMapAttribution;
    scene.onSatelliteAttributions = setSatelliteAttribution;
    scene.onTerrainCredit = setTerrainCredit;
    scene.onZoomOut = () => closeRef.current();
    scene.onZoomWarning = setZoomWarning;
    scene.onModelReady = setReadyId;
    scene.onPickTable = (id) => {
      const t = openRef.current.tables.find((x) => x.id === id);
      if (t) openRef.current.onOpen(t);
    };
    scene.onAutoRotate = (on) => {
      setAutoRotate(on);
      // The opening move ends in a three-quarter view, close to Orbit's.
      if (on) setPreset('orbit');
    };
    for (const [id, el] of tagEls.current) scene.setTag(id, el);
    scene.setCalloutLayer(calloutRef.current);
    scene.setLoupe(loupeRef.current);
    scene.onLoupe = setLoupeOn;
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
    // The tables come from the build; they do not change while the page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    sceneRef.current?.setOpen(open?.id ?? null);
    setAutoRotate(false);
    setPreset('top');
  }, [open?.id]);

  // The site is always light: the pale roadmap, and the scene's colors from the tokens.
  useEffect(() => {
    const css = getComputedStyle(document.documentElement);
    sceneRef.current?.setColors(
      css.getPropertyValue('--muted').trim(),
      css.getPropertyValue('--plate').trim(),
    );
    sceneRef.current?.setMapStyle(false);
  }, []);

  /** Where a card's picture is, relative to the viewport, scrolled into view first. */
  const plateBox = (id: number): Box | null => {
    const container = containerRef.current;
    const plate = container?.querySelector<HTMLElement>(
      `[data-table-id="${id}"] [data-plate]`,
    );
    if (!container || !plate || plate.offsetParent === null) return null;
    plate.scrollIntoView({ block: 'nearest' });
    const r = plate.getBoundingClientRect();
    const c = container.getBoundingClientRect();
    if (r.width < 1) return null;
    return {
      left: r.left - c.left,
      top: r.top - c.top,
      width: r.width,
      height: r.height,
    };
  };

  // Open and close: measure the card, then let CSS move the viewer.
  const previous = useRef(open);
  useLayoutEffect(() => {
    const was = previous.current;
    previous.current = open;
    if (open) setShown(open);
    if (open && !was) {
      const b = plateBox(open.id);
      setBox(b);
      setPhase(b ? 'from' : 'open');
      // Keep the render up until the table's 3D model is there to fade into.
      setReadyId(null);
      setHoldStill(open.id);
    } else if (!open && was) {
      const b = plateBox(was.id);
      setBox(b);
      setPhase(b ? 'closing' : 'closed');
      setHoldStill(null);
    } else if (open && was) {
      setHoldStill(null);
    }
  }, [open?.id]);

  useEffect(() => {
    if (holdStill != null && readyId === holdStill) setHoldStill(null);
  }, [holdStill, readyId]);

  useEffect(() => {
    if (phase === 'from') {
      let id = requestAnimationFrame(
        () => (id = requestAnimationFrame(() => setPhase('open'))),
      );
      return () => cancelAnimationFrame(id);
    }
    if (phase === 'closing') {
      const t = window.setTimeout(() => setPhase('closed'), GROW_MS + 30);
      return () => window.clearTimeout(t);
    }
  }, [phase]);

  const full: CSSProperties = {
    left: 0,
    top: 32,
    width: '100%',
    height: 'calc(100% - 56px)',
  };
  const viewerStyle: CSSProperties =
    phase === 'open' || !box
      ? full
      : { left: box.left, top: box.top, width: box.width, height: box.height };
  if (phase === 'from') viewerStyle.transition = 'none';

  const mini = !!open;
  const index = shown ? tables.findIndex((t) => t.id === shown.id) : -1;

  const choosePreset = (p: ViewPreset) => {
    setPreset(p);
    sceneRef.current?.setPreset(p);
  };
  const toggleRotate = () => {
    setAutoRotate((on) => {
      sceneRef.current?.setAutoRotate(!on);
      return !on;
    });
  };
  const reset = () => {
    setPreset('top');
    setAutoRotate(false);
    sceneRef.current?.setAutoRotate(false);
    sceneRef.current?.resetView();
  };

  const chooseGround = (g: Ground) => {
    setGround(g);
    sceneRef.current?.setGround(g);
  };
  const groundButtons = (
    <div className='flex' role='group' aria-label='Ground'>
      {(
        [
          ['satellite', 'satellite'],
          ['terrain', 'terrain'],
          ['3d', '3d'],
        ] as const
      ).map(([id, label], i) => (
        <button
          key={id}
          type='button'
          onClick={() => chooseGround(id)}
          aria-pressed={ground === id}
          title={
            id === '3d'
              ? 'Google’s photorealistic 3D tiles'
              : id === 'satellite'
                ? 'Google’s satellite imagery'
                : 'USGS lidar ground with an aerial photo'
          }
          className={button(
            ground === id ? 'secondary' : 'outline',
            'xs',
            i > 0 ? '-ml-px' : '',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const viewButtons = (
    <div className='flex' role='group' aria-label='View'>
      {VIEWS.map((v, i) => (
        <button
          key={v.id}
          type='button'
          onClick={() => choosePreset(v.id)}
          className={button(
            preset === v.id ? 'secondary' : 'outline',
            'xs',
            i > 0 ? '-ml-px' : '',
          )}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
  const rotateButton = (
    <button
      type='button'
      onClick={toggleRotate}
      aria-pressed={autoRotate}
      title='Turn by itself'
      aria-label='Turn by itself'
      className={button(
        autoRotate ? 'secondary' : 'ghost',
        'icon',
        'bg-background',
      )}
    >
      <Icon name='Play' />
    </button>
  );

  return (
    <div ref={containerRef} className='relative min-h-0 flex-1 overflow-hidden'>
      {/* Left pane: the tables (or About). Fades out under the growing viewer. */}
      <div
        inert={open ? true : undefined}
        className={`absolute inset-y-0 left-0 w-full overflow-y-auto overscroll-contain transition-opacity duration-300 lg:w-(--split) ${
          open ? 'opacity-0' : 'opacity-100'
        } ${!open && mobileView === 'map' ? 'max-lg:hidden' : ''}`}
      >
        {children}
      </div>

      {/* deck.gl listens on the canvas; the scene clips it to the two views. */}
      <canvas
        ref={canvasRef}
        className='absolute inset-0 z-10 size-full touch-none'
      />

      {/* The viewer: toolbar, the 3D view, status strip. */}
      <div
        className={`pointer-events-none absolute inset-0 z-20 ${phase === 'closed' ? 'hidden' : ''}`}
      >
        <div
          className={`pointer-events-auto absolute inset-x-0 top-0 flex h-8 items-center gap-2 border-b border-border bg-background px-1 transition-opacity duration-200 ${
            phase === 'open' ? 'opacity-100 delay-200' : 'opacity-0'
          }`}
        >
          <button
            type='button'
            onClick={onClose}
            title='Back to the grid (Esc)'
            className={button('outline')}
          >
            <Icon name='ArrowLeft01' />
            <span className='max-sm:hidden'>all tables</span>
            <span className='sm:hidden'>all</span>
          </button>
          <span className='h-4 w-px bg-border' />
          <span className='truncate text-xs font-bold'>
            {shown && tableTitle(shown)}
          </span>
          <span className='shrink-0 text-[11px] text-muted-foreground tabular-nums'>
            {index + 1} of {tables.length}
          </span>
          <span className='h-4 w-px bg-border max-sm:hidden' />
          <div className='flex gap-2 max-sm:hidden'>
            {groundButtons}
            {viewButtons}
            <div className='flex gap-1'>
              {rotateButton}
              <button
                type='button'
                onClick={reset}
                title='Reset view'
                aria-label='Reset view'
                className={button('ghost', 'icon')}
              >
                <Icon name='Redo02' />
              </button>
            </div>
          </div>
          {shown && (
            <a
              href={modelUrl(shown)}
              download
              className={button('outline', 'xs', 'ml-auto max-md:hidden')}
            >
              <Icon name='Download01' />
              download .glb
            </a>
          )}
          <div
            className='ml-auto flex md:ml-0'
            role='group'
            aria-label='Other tables'
          >
            <button
              type='button'
              onClick={() => onStep(-1)}
              title='Previous table (←)'
              aria-label='Previous table'
              className={button('ghost', 'icon')}
            >
              <Icon name='ArrowLeft01' />
            </button>
            <button
              type='button'
              onClick={() => onStep(1)}
              title='Next table (→)'
              aria-label='Next table'
              className={button('ghost', 'icon', '-ml-px')}
            >
              <Icon name='ArrowRight01' />
            </button>
          </div>
        </div>

        <div
          ref={viewerRef}
          className='viewer-box pointer-events-none absolute overflow-hidden'
          style={viewerStyle}
        >
          {shown && (
            <img
              src={renderUrl(shown, 'jpg')}
              alt=''
              draggable={false}
              className={`pointer-events-none absolute inset-0 size-full scale-[1.35] bg-plate object-contain transition-opacity ${
                phase === 'open' && holdStill == null
                  ? 'opacity-0 delay-700 duration-500'
                  : 'opacity-100 duration-0'
              }`}
            />
          )}
          <p
            role='status'
            aria-live='polite'
            className={`pointer-events-none absolute top-3 left-1/2 -translate-x-1/2 border border-control bg-background px-3 py-1.5 text-center text-xs transition-opacity duration-300 max-sm:top-12 max-sm:w-[calc(100%-16px)] ${
              zoomWarning && phase === 'open' ? 'opacity-100' : 'opacity-0'
            }`}
          >
            {zoomWarning && 'keep zooming out and you’ll leave this table.'}
          </p>
          <div className='pointer-events-auto absolute top-2 left-2 flex gap-1 sm:hidden'>
            <div className='bg-background'>{groundButtons}</div>
            <div className='bg-background'>{viewButtons}</div>
            {rotateButton}
          </div>
          {/* The loupe: the scene draws a magnified view of the scan under the
              pointer into this box (scene/archive-scene.ts); this is its frame. */}
          <div
            ref={loupeRef}
            aria-hidden='true'
            className={`absolute bottom-6 left-2 size-56 border border-control transition-opacity duration-150 max-sm:hidden ${
              loupeOn && phase === 'open' ? 'opacity-100' : 'opacity-0'
            }`}
          >
            <span className='absolute top-1/2 left-1/2 size-2 -translate-1/2 border border-accent' />
            <span className='absolute top-0 left-0 bg-background px-1 text-[10px] leading-4 text-muted-foreground'>
              ×4
            </span>
          </div>
          {(ground === 'terrain'
            ? terrainCredit
            : ground === '3d'
              ? attribution
              : satelliteAttribution) && (
            <p className='pointer-events-none absolute bottom-1 left-2 max-w-[calc(100%-188px)] truncate bg-background/80 px-1 text-[10px] text-muted-foreground lg:max-w-[calc(100%-360px)]'>
              {ground === 'terrain'
                ? terrainCredit
                : `Google · ${ground === '3d' ? `${attribution} · ${PARK_CREDIT}` : satelliteAttribution}`}
            </p>
          )}
        </div>

        <div
          className={`pointer-events-auto absolute inset-x-0 bottom-0 flex h-6 items-center gap-2 border-t border-border bg-background px-3 text-[11px] text-muted-foreground tabular-nums transition-opacity duration-200 ${
            phase === 'open' ? 'opacity-100 delay-200' : 'opacity-0'
          }`}
        >
          {shown && (
            <span className='truncate'>
              hellman hollow / {formatCoords(shown)} / rotation{' '}
              {formatDegrees(shown.rotation_y)} / {shown.file}
            </span>
          )}
          <span className='ml-auto shrink-0 max-md:hidden'>
            drag to orbit / scroll to zoom / zoom out to leave / ← → next table
            / esc back to the grid
          </span>
        </div>
      </div>

      {/* Right pane: the map. Becomes the minimap while a table is open. */}
      <div
        data-mini={mini ? '' : undefined}
        data-mobile-hidden={!open && mobileView === 'grid' ? '' : undefined}
        className={`map-pane pointer-events-none absolute z-30 flex flex-col bg-transparent ${mini ? 'border border-control' : 'border-l border-border max-lg:border-l-0'}`}
      >
        <div
          className={`pointer-events-auto flex shrink-0 items-center gap-2 border-b border-border bg-background pr-1 pl-3 ${mini ? 'h-7' : 'h-8'}`}
        >
          <h2 className={MICRO}>map/</h2>
          <span className='truncate text-[11px] text-muted-foreground max-xl:hidden'>
            {mini
              ? 'click a table to go to it'
              : 'hover a table to find it; click to open it.'}
          </span>
          {mini ? (
            <button
              type='button'
              onClick={onClose}
              title='Back to the grid (Esc)'
              aria-label='Back to the grid'
              className={button('ghost', 'icon', 'ml-auto')}
            >
              <Icon name='GridView' />
            </button>
          ) : (
            <div className='ml-auto'>
              <MobileToggle view={mobileView} onView={onMobileView} />
            </div>
          )}
        </div>
        <div className='relative min-h-0 flex-1'>
          <div ref={mapRef} className='absolute inset-0' />
          <div className='pointer-events-none absolute inset-0 overflow-hidden'>
            {/* Each table's dot and the line to its label (scene/tags.ts). */}
            <svg
              ref={calloutRef}
              aria-hidden='true'
              className='absolute inset-0 size-full overflow-visible'
            />
            {tables.map((t) => {
              const isOpenTable = open?.id === t.id;
              const lit = isOpenTable || (!open && hoveredId === t.id);
              const dot = !!open && !isOpenTable;
              return (
                <button
                  key={t.id}
                  type='button'
                  ref={(el) => {
                    if (el) tagEls.current.set(t.id, el);
                    else tagEls.current.delete(t.id);
                    sceneRef.current?.setTag(t.id, el);
                  }}
                  onMouseEnter={() => !open && onHover(t.id)}
                  onMouseLeave={() => !open && onHover(null)}
                  onClick={() => onOpen(t)}
                  aria-label={tableTitle(t)}
                  title={tableTitle(t)}
                  data-dot={dot ? '' : undefined}
                  data-lit={lit && !dot ? '' : undefined}
                  style={{ visibility: 'hidden' }}
                  className={`pointer-events-auto absolute top-0 left-0 cursor-pointer border border-foreground will-change-transform ${
                    dot
                      ? 'size-2.25 bg-background hover:bg-foreground'
                      : `flex h-4.5 items-center px-1 text-[10px] leading-none font-bold tabular-nums ${
                          lit
                            ? 'z-10 border-accent bg-accent text-accent-foreground'
                            : 'bg-background text-foreground'
                        }`
                  }`}
                >
                  {!dot && tableTag(t)}
                </button>
              );
            })}
          </div>
          {!API_KEY && (
            <p className='absolute inset-x-4 top-4 border border-control bg-background px-3 py-2 text-xs'>
              Add VITE_GOOGLE_MAPS_API_KEY to .env (with the Map Tiles API
              enabled) to load Google’s map and 3D tiles.
            </p>
          )}
          {mapAttribution && (
            <p className='pointer-events-none absolute bottom-1 left-2 max-w-[calc(100%-16px)] truncate bg-background/80 px-1 text-[10px] text-muted-foreground'>
              Google · {mapAttribution}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
