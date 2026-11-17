// Reading streaks for the classics reader: one row per day you read a
// chapter (classic_days). The frontend has a twin for guests
// (frontend/src/lib/classicsProgress.js).

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (ms) => new Date(ms).toISOString().slice(0, 10);

// The reader's own calendar day (its time zone), trusted only within a day of
// the server's UTC date; anything else falls back to the UTC date.
export function readingDay(clientDay, now = Date.now()) {
  const near = [isoDay(now - DAY_MS), isoDay(now), isoDay(now + DAY_MS)];
  return near.includes(clientDay) ? clientDay : near[1];
}

// days: 'YYYY-MM-DD' strings, any order. Consecutive days ending today, or
// ending yesterday (the streak isn't lost until a whole day is missed).
export function streakFrom(days, today) {
  const have = new Set(days);
  const t = Date.parse(`${today}T00:00:00Z`);
  let start = have.has(today) ? t : t - DAY_MS;
  let n = 0;
  while (have.has(isoDay(start - n * DAY_MS))) n++;
  return n;
}
