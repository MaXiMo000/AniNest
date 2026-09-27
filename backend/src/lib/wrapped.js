// AniNest Wrapped (routes/wrapped.js): one user's year in anime, built from
// episode_log (Phase 0), their list and their reviews. Pure, so every number
// on the card is tested without a database.
//
// Only episodes logged one small step at a time count (favorites.js skips
// catch-up jumps), so this is what someone actually watched on AniNest this
// year, not their whole backlog. Watch time is an estimate: AniList's episode
// length isn't stored, so a TV/ONA/OVA episode counts as 24 minutes and a
// movie as 100.

const MINUTES = { Movie: 100, Special: 12, Music: 4 };
const DEFAULT_MINUTES = 24;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// A title for the card from the genre someone watched most.
const PERSONAS = {
  Action: 'Adrenaline Chaser',
  Adventure: 'World Wanderer',
  Comedy: 'Professional Laugher',
  Drama: 'Tissue Box Veteran',
  Fantasy: 'Isekai Resident',
  Horror: 'Lights-On Sleeper',
  'Mahou Shoujo': 'Magical Guardian',
  Mecha: 'Giant Robot Pilot',
  Music: 'Front Row Idol Fan',
  Mystery: 'Armchair Detective',
  Psychological: 'Mind Game Survivor',
  Romance: 'Hopeless Romantic',
  'Sci-Fi': 'Future Dreamer',
  'Slice of Life': 'Cozy Days Connoisseur',
  Sports: 'Bench Warmer Turned MVP',
  Supernatural: 'Spirit Seer',
  Thriller: 'Edge-of-Seat Regular',
};

// "2026-03-04 21:15:00" (SQLite datetime, UTC) shifted into the viewer's
// local time. With an IANA timeZone each date gets its own offset, so daylight
// saving is right all year; otherwise tzOffsetMin (Date#getTimezoneOffset,
// minutes BEHIND UTC) is applied to every date.
function localDate(watchedAt, tzOffsetMin, fmt) {
  const utc = Date.parse(`${watchedAt.replace(' ', 'T')}Z`);
  if (!fmt) return new Date(utc - tzOffsetMin * 60000);
  const p = Object.fromEntries(fmt.formatToParts(utc).map((x) => [x.type, Number(x.value)]));
  return new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second));
}
const dayKey = (d) => d.toISOString().slice(0, 10);

function longestStreak(days) {
  const sorted = [...days].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of sorted) {
    const t = Date.parse(`${d}T00:00:00Z`);
    run = prev !== null && t - prev === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

// logs: [{ mal_id, episode, watched_at }] (any years; filtered here)
// favorites: [{ mal_id, title, image, type, genres: [names], episodes }]
// reviews: [{ mal_id, rating (1-10) }]
export function buildWrapped({ year, logs, favorites, reviews = [], tzOffsetMin = 0, timeZone }) {
  const shows = new Map(favorites.map((f) => [Number(f.mal_id), f]));
  const fmt = timeZone && new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',
  });
  const mine = logs
    .map((l) => ({ ...l, mal_id: Number(l.mal_id), episode: Number(l.episode), at: localDate(l.watched_at, tzOffsetMin, fmt) }))
    .filter((l) => l.at.getUTCFullYear() === year);
  if (!mine.length) return { year, empty: true };

  const perShow = new Map();
  const perMonth = Array(12).fill(0);
  const perDayShow = new Map();
  const days = new Set();
  let minutes = 0;
  for (const l of mine) {
    const show = shows.get(l.mal_id);
    perShow.set(l.mal_id, (perShow.get(l.mal_id) || 0) + 1);
    perMonth[l.at.getUTCMonth()] += 1;
    const day = dayKey(l.at);
    days.add(day);
    const k = `${day}|${l.mal_id}`;
    perDayShow.set(k, (perDayShow.get(k) || 0) + 1);
    minutes += MINUTES[show?.type] || DEFAULT_MINUTES;
  }

  const card = (malId, extra) => {
    const s = shows.get(malId);
    return { mal_id: malId, title: s?.title || 'A show you removed', image: s?.image || null, ...extra };
  };

  const topShows = [...perShow]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 5)
    .map(([malId, episodes]) => card(malId, { episodes }));

  const genreWeight = new Map();
  for (const [malId, n] of perShow) {
    for (const g of shows.get(malId)?.genres || []) genreWeight.set(g, (genreWeight.get(g) || 0) + n);
  }
  const topGenres = [...genreWeight].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3)
    .map(([name, episodes]) => ({ name, episodes }));

  const busiest = perMonth.reduce((best, n, i) => (n > perMonth[best] ? i : best), 0);

  let binge = null;
  for (const [k, n] of perDayShow) {
    const [date, malId] = k.split('|');
    if (!binge || n > binge.episodes || (n === binge.episodes && date < binge.date)) binge = { date, malId: Number(malId), episodes: n };
  }

  // Finished this year: the final episode itself was logged this year.
  const finished = [...new Set(mine
    .filter((l) => {
      const total = Number(shows.get(l.mal_id)?.episodes) || 0;
      return total > 0 && l.episode === total;
    })
    .map((l) => l.mal_id))];

  const watched = new Set(perShow.keys());
  const rated = reviews.filter((r) => watched.has(Number(r.mal_id)))
    .sort((a, b) => b.rating - a.rating || Number(a.mal_id) - Number(b.mal_id));

  return {
    year,
    empty: false,
    episodes: mine.length,
    hours: Math.round(minutes / 60),
    shows: perShow.size,
    finished: finished.length,
    daysWatched: days.size,
    longestStreak: longestStreak(days),
    busiestMonth: { name: MONTHS[busiest], episodes: perMonth[busiest] },
    months: perMonth,
    // One episode in a day isn't a binge.
    biggestBinge: binge && binge.episodes >= 2 ? card(binge.malId, { episodes: binge.episodes, date: binge.date }) : null,
    topShows,
    topGenres,
    favorite: rated[0] ? card(Number(rated[0].mal_id), { rating: Number(rated[0].rating) }) : null,
    persona: topGenres[0] ? PERSONAS[topGenres[0].name] || `${topGenres[0].name} Devotee` : 'Anime Explorer',
  };
}
