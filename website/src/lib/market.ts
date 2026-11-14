/** Small Batch, where the SD-card edition is sold. */
export const MARKET = {
  name: "small batch: a dataset farmers market",
  edition: "fall harvest edition",
  day: "sat nov 15",
  date: "nov 15, 2026",
  place: "larpa, bushwick",
  url: "https://smallbatchdata.market/",
  /** Midnight after market day in New York. */
  over: Date.parse("2026-11-16T00:00:00-05:00"),
};

/** Before and on market day the copy says "now"; afterwards it says where the cards went. */
export const inSeason = () => Date.now() < MARKET.over;
