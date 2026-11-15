import { lazy, Suspense } from 'react';
import { inSeason, MARKET } from '../lib/market';
import table from '../assets/coming-across.webp';
import turrell from '../assets/turrell-three-gems.webp';
import cards from '../assets/sd-cards.webp';
import { MICRO } from './ui';

// three.js only loads when someone opens About.
const SdCard = lazy(() => import('./SdCard'));

const SHOW = 'https://www.tiat.place/exhibitions/computer-love';
const SITE = 'https://www.yufengzhao.com/';

/** What is on the card, as its readme.txt lists it. */
const CONTENTS = [
  ['card', '8 gb sd'],
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
      <p className='text-[13px] leading-5.25'>
        made by{' '}
        <a href={SITE} target='_blank' rel='noreferrer' className={LINK}>
          yufeng zhao
        </a>
      </p>

      {/* On a phone: the table photo, the story, then the Turrell. Wider: the
          story, then the two photos side by side, the columns in the ratio of
          their widths (4:3 and 3:4) so the photos stand the same height. */}
      <div className='grid items-start gap-3 sm:grid-cols-[16fr_9fr] sm:gap-x-4'>
        <figure className='flex flex-col gap-2 sm:col-start-1 sm:row-start-2'>
          <img
            src={table}
            alt='Looking down at a green picnic table covered in graffiti and the stencil “tables subject to reservation”, a camera lying on it.'
            width={1200}
            height={900}
            loading='lazy'
            className='aspect-4/3 w-full bg-muted object-cover'
          />
          <figcaption className='text-[11px] text-muted-foreground'>
            coming across one of the tables in hellman hollow. february 13,
            2026, 1:30 pm.
          </figcaption>
        </figure>

        <div className='flex max-w-prose flex-col gap-3 text-[13px] leading-5.25 sm:col-span-2 sm:row-start-1'>
          <p>
            february 13, 2026. i was in town setting up{' '}
            <a href={SHOW} target='_blank' rel='noreferrer' className={LINK}>
              computer love
            </a>{' '}
            at tiat. that morning i walked into golden gate park, came across
            these picnic tables in hellman hollow, and scanned every one i saw.
          </p>
          <p>
            later, i matched each scan to its coordinates with google earth. i
            was surprised that google earth showed more tables than i found in
            the park. some of them just weren’t there when i visited, which is
            why you see the jumps in table numbers in my scans.
          </p>
          <p>
            after the scans, i walked over to the de young and saw the james
            turrell.
          </p>
        </div>

        <figure className='flex flex-col gap-2 max-sm:max-w-sm sm:col-start-2 sm:row-start-2'>
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
      </div>

      <h2 className={`${MICRO} mt-4`}>sd card/</h2>
      <div className='flex max-w-3xl flex-col gap-4 sm:flex-row sm:items-start'>
        <div className='aspect-4/5 w-full max-w-64 shrink-0 bg-muted max-sm:self-center sm:w-56'>
          <Suspense fallback={null}>
            <SdCard className='size-full' />
          </Suspense>
        </div>
        <div className='flex min-w-0 flex-col gap-3 text-[13px] leading-5.25'>
          <p>
            all 12 scans on one 8 gb sd card, labeled with a custom sticker. i
            made 30 of them for the market.
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

      <figure className='flex max-w-xl flex-col gap-2'>
        <img
          src={cards}
          alt='The finished SD cards, each with its tiled sticker, in a clear plastic bin among their empty cases.'
          width={1200}
          height={900}
          loading='lazy'
          className='aspect-4/3 w-full bg-muted object-cover'
        />
        <figcaption className='text-[11px] text-muted-foreground'>
          just put on all the stickers and burning the cards on the night of nov
          7, 2026.
        </figcaption>
      </figure>

      <p className='mt-3 text-[11px] text-muted-foreground'>
        by yufeng zhao. special thanks to my dad, for smuggling the sd cards
        over from china.
      </p>
    </article>
  );
}
