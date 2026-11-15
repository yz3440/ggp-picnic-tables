import { lazy, Suspense } from 'react';
import { inSeason, MARKET } from '../lib/market';
import turrell from '../assets/turrell-three-gems.webp';
import { MICRO } from './ui';

// three.js only loads when someone opens About.
const SdCard = lazy(() => import('./SdCard'));

const SHOW = 'https://www.tiat.place/exhibitions/computer-love';

/** What is on the card, as its readme.txt lists it. */
const CONTENTS = [
  ['files', '12 × .glb, meters, +y up'],
  [
    'readme.txt',
    'latitude, longitude, altitude, pitch, yaw, roll and scale for each table',
  ],
  ['scanned', 'february 13, 2026, hellman hollow'],
  ['label', '20 × 25 mm, the twelve tables tiled'],
  ['edition', '30 cards'],
];

const LINK =
  'underline decoration-control underline-offset-2 hover:decoration-foreground';

/** The About page (/about): one column, the width of the text. */
export default function About() {
  return (
    <article className='mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-8 pb-16'>
      <h1 className='text-4xl font-bold tracking-tight'>about</h1>

      <div className='flex max-w-prose flex-col gap-3 text-[13px] leading-5.25'>
        <p>
          february 13, 2026. i was in town setting up{' '}
          <a href={SHOW} target='_blank' rel='noreferrer' className={LINK}>
            computer love
          </a>{' '}
          at tiat. that morning i walked into golden gate park, came across
          these picnic tables in hellman hollow, and scanned every one i could
          see.
        </p>
        <p>
          later, when i went to match each scan to its spot on google earth, i
          was surprised. google earth and the map show more tables than i found
          in the park; some of them just weren’t there. i don’t know what
          happened to them. it’s why the numbers skip: 1, 2, 6 through 12, 15 &
          16, 19, 20.
        </p>
        <p>
          after the scans, i walked over to the de young and saw the james
          turrell.
        </p>
      </div>

      <figure className='flex max-w-sm flex-col gap-2'>
        <img
          src={turrell}
          alt='Looking up inside James Turrell’s Three Gems: a round opening in a pale dome, blue sky and a cloud.'
          width={900}
          height={1200}
          loading='lazy'
          className='aspect-3/4 w-full bg-muted object-cover'
        />
        <figcaption className='text-[11px] text-muted-foreground'>
          james turrell, three gems, de young museum. february 13, 2026, 4 pm.
        </figcaption>
      </figure>

      <h2 className={`${MICRO} mt-4`}>sd card/</h2>
      <div className='flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-start'>
        <div className='aspect-4/5 w-full max-w-64 shrink-0 bg-muted max-sm:self-center sm:w-56'>
          <Suspense fallback={null}>
            <SdCard className='size-full' />
          </Suspense>
        </div>
        <div className='flex min-w-0 flex-col gap-3 text-[13px] leading-5.25'>
          <p>
            all twelve scans on one sd card, labeled with a sticker tiled from
            the tables themselves. i made 30 of them for the market. drag the
            card to turn it.
          </p>
          <dl className='grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[11px] leading-4'>
            {CONTENTS.map(([k, v]) => (
              <div key={k} className='contents'>
                <dt className='text-muted-foreground'>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
          <p>
            {inSeason() ? 'find it at ' : 'first picked for '}
            <a
              href={MARKET.url}
              target='_blank'
              rel='noreferrer'
              className={LINK}
            >
              {MARKET.name}
            </a>
            , {MARKET.edition} / {inSeason() ? MARKET.day : MARKET.date} /{' '}
            {MARKET.place}.
          </p>
        </div>
      </div>

      <p className='mt-3 text-[11px] text-muted-foreground'>by yufeng zhao.</p>
    </article>
  );
}
