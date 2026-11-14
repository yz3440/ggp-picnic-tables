import { inSeason, MARKET } from "../lib/market";

/** The strip under the bar, in the market's own words. The whole strip links to it. */
export default function SeasonTicker() {
  const now = inSeason();
  const items = now
    ? ["now in season", MARKET.name, MARKET.edition, MARKET.day, MARKET.place, "12 picnic tables on one sd card", "smallbatchdata.market"]
    : [`picked for ${MARKET.name}`, MARKET.edition, MARKET.date, MARKET.place, "12 picnic tables on one sd card", "smallbatchdata.market"];
  // Each run is wider than any screen, so sliding by one run never shows a gap.
  const run = `${items.join("  *  ")}  *  `.repeat(3);
  const label = now
    ? `The SD card is at Small Batch: A Dataset Farmers Market, Fall Harvest Edition, Saturday November 15 at LARPA, Bushwick`
    : `The SD card was made for Small Batch: A Dataset Farmers Market, Fall Harvest Edition, November 15, 2026 at LARPA, Bushwick`;

  return (
    <a
      href={MARKET.url}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="ticker relative z-40 flex h-6.5 shrink-0 items-center overflow-hidden bg-accent text-[11px] font-medium text-accent-foreground outline-none focus-visible:ring-1 focus-visible:ring-accent-foreground focus-visible:ring-inset"
    >
      <span aria-hidden="true" className="ticker-run flex shrink-0 pl-3 whitespace-pre">
        <span>{run}</span>
        <span>{run}</span>
      </span>
    </a>
  );
}
