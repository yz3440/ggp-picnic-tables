import type { PicnicTable } from '../types';
import TableCard from './TableCard';
import { button, MICRO } from './ui';

export type Order = 'number' | 'east';
export type MobileView = 'grid' | 'map';

interface GridPanelProps {
  tables: PicnicTable[];
  order: Order;
  onOrder: (o: Order) => void;
  hoveredId: number | null;
  onHover: (id: number | null) => void;
  onOpen: (table: PicnicTable) => void;
  mobileView: MobileView;
  onMobileView: (v: MobileView) => void;
}

/** The left pane: the intro, then the tables. It scrolls; the map beside it does not. */
export default function GridPanel({
  tables,
  order,
  onOrder,
  hoveredId,
  onHover,
  onOpen,
  mobileView,
  onMobileView,
}: GridPanelProps) {
  return (
    <>
      <section className='px-4 pt-5 pb-4'>
        <h1 className='text-4xl font-bold tracking-tight'>picnic tables</h1>
        <p className='mt-2 max-w-2xl text-[13px] leading-5.25'>
          12 picnic tables in hellman hollow, golden gate park, scanned in 3d
          with words and drawings left by visitors.
        </p>
        <p className='mt-2 text-[11px] text-muted-foreground'>
          {tables.length} scans / .glb, meters, +y up / scanned 2026-02-13
        </p>
      </section>

      <div className='sticky top-0 z-10 flex h-8 items-center gap-2 border-y border-border bg-background pr-1 pl-4'>
        <h2 className={MICRO}>tables/</h2>
        <div className='ml-auto flex' role='group' aria-label='Order'>
          <button
            type='button'
            onClick={() => onOrder('number')}
            className={button(order === 'number' ? 'secondary' : 'outline')}
          >
            by number
          </button>
          <button
            type='button'
            onClick={() => onOrder('east')}
            className={button(
              order === 'east' ? 'secondary' : 'outline',
              'xs',
              '-ml-px',
            )}
          >
            east to west
          </button>
        </div>
        <MobileToggle view={mobileView} onView={onMobileView} />
      </div>

      <div className='grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-4 gap-y-6 p-4 pb-8'>
        {tables.map((t, i) => (
          <TableCard
            key={t.id}
            table={t}
            index={i}
            linked={hoveredId === t.id}
            onHover={onHover}
            onOpen={onOpen}
          />
        ))}
      </div>

      <footer className='flex border-t border-border px-4 py-3 text-xs text-muted-foreground'>
        <span>yufeng zhao</span>
        <span className='ml-auto tabular-nums'>
          {tables.length} tables / 2026
        </span>
      </footer>
    </>
  );
}

/** Below 1024 px the panes take turns. */
export function MobileToggle({
  view,
  onView,
}: {
  view: MobileView;
  onView: (v: MobileView) => void;
}) {
  return (
    <div className='flex lg:hidden' role='group' aria-label='View'>
      <button
        type='button'
        onClick={() => onView('grid')}
        className={button(view === 'grid' ? 'secondary' : 'outline')}
      >
        grid
      </button>
      <button
        type='button'
        onClick={() => onView('map')}
        className={button(
          view === 'map' ? 'secondary' : 'outline',
          'xs',
          '-ml-px',
        )}
      >
        map
      </button>
    </div>
  );
}
