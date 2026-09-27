// Season OP/ED tournament (routes/tournaments.js): a 16-song single-elimination
// bracket per season, one for openings and one for endings. Pure, so the
// bracket, the clock and the seeding are tested without a database.
//
// Seeds come from the show's popularity (AniList list count), one song per
// show: seed 1 is the biggest show's first opening. Rounds run on a fixed
// clock from the tournament's start (ROUND_DAYS each). When a round closes the
// song with more votes goes through; a tie, including 0-0 on a quiet site,
// goes to the better seed. So the bracket always finishes, and it reads as a
// popularity bracket until people vote.

export const KINDS = ['OP', 'ED'];
export const ROUND_DAYS = 3;
export const MAX_SIZE = 16;
// A season's tournament opens this far into the season, once most shows have
// aired enough episodes for people to know the songs. Until then the page
// keeps showing the previous season's.
export const OPENS_AFTER_DAYS = 42;

const DAY_MS = 24 * 60 * 60 * 1000;
const SEASONS = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

export function seasonOf(date) {
  return { season: SEASONS[Math.floor(date.getUTCMonth() / 3)], year: date.getUTCFullYear() };
}

export function seasonStartMs({ season, year }) {
  return Date.UTC(year, SEASONS.indexOf(season) * 3, 1);
}

export function previousSeason({ season, year }) {
  const i = SEASONS.indexOf(season);
  return i === 0 ? { season: 'FALL', year: year - 1 } : { season: SEASONS[i - 1], year };
}

export function isSeason(season, year) {
  return SEASONS.includes(season) && Number.isInteger(year) && year >= 1960 && year <= 2100;
}

// Which season's tournament the page shows at `now`.
export function headlineSeason(now) {
  const current = seasonOf(now);
  return now.getTime() >= seasonStartMs(current) + OPENS_AFTER_DAYS * DAY_MS ? current : previousSeason(current);
}

// Standard seeding, so the top two seeds can only meet in the final:
// 16 -> [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11].
export function bracketOrder(size) {
  let order = [1];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function bracketSize(count) {
  if (count >= 16) return 16;
  if (count >= 8) return 8;
  return 0;
}

const themeNumber = (t) => Number(/(\d+)/.exec(t.slug || '')?.[1]) || 1;

// shows: [{ mal_id, title, image, themes: [{ slug, type, title, artist, videoUrl }] }],
// most popular first. One song per show (its lowest-numbered OP or ED with a
// title), in show order, capped at MAX_SIZE. Seeds are the array order + 1.
export function pickEntries(shows, kind) {
  const entries = [];
  for (const show of shows) {
    if (entries.length >= MAX_SIZE) break;
    const song = (show.themes || [])
      .filter((t) => t.type === kind && t.title)
      .sort((a, b) => themeNumber(a) - themeNumber(b))[0];
    if (!song) continue;
    entries.push({
      mal_id: show.mal_id,
      anime_title: show.title,
      image: show.image || null,
      slug: song.slug,
      title: song.title,
      artist: song.artist || null,
      videoUrl: song.videoUrl || null,
    });
  }
  return entries;
}

export function roundName(songsLeft) {
  if (songsLeft === 2) return 'Final';
  if (songsLeft === 4) return 'Semifinals';
  if (songsLeft === 8) return 'Quarterfinals';
  return `Round of ${songsLeft}`;
}

// t: { size, startsAt (ms), roundDays }
// tally: [{ round, match, seed, n }] vote counts
// Returns every round with its matches, the open round (null before the start
// and after the final) and the champion once the final has closed.
export function resolveBracket(t, tally, now) {
  const counts = new Map(tally.map((v) => [`${v.round}:${v.match}:${v.seed}`, Number(v.n)]));
  const roundMs = t.roundDays * DAY_MS;
  const total = Math.log2(t.size);
  let slots = bracketOrder(t.size);
  const rounds = [];
  for (let r = 1; r <= total; r += 1) {
    const opensAt = t.startsAt + (r - 1) * roundMs;
    const closesAt = opensAt + roundMs;
    const status = now >= closesAt ? 'done' : now >= opensAt ? 'open' : 'upcoming';
    const matches = [];
    for (let m = 0; m < slots.length / 2; m += 1) {
      const a = slots[2 * m];
      const b = slots[2 * m + 1];
      const votesA = a ? counts.get(`${r}:${m}:${a}`) || 0 : 0;
      const votesB = b ? counts.get(`${r}:${m}:${b}`) || 0 : 0;
      let winner = null;
      if (status === 'done' && a && b) winner = votesA > votesB ? a : votesB > votesA ? b : Math.min(a, b);
      matches.push({ match: m, a, b, votesA, votesB, winner, status });
    }
    rounds.push({ round: r, name: roundName(slots.length), opensAt, closesAt, status, matches });
    slots = matches.map((x) => x.winner);
  }
  const open = rounds.find((r) => r.status === 'open');
  const last = rounds[rounds.length - 1];
  return {
    rounds,
    currentRound: open ? open.round : null,
    finished: last.status === 'done',
    champion: last.status === 'done' ? last.matches[0].winner : null,
  };
}

// Why a vote can't count, or null when it can: only the open round, only a
// real match in it, only one of that match's two songs.
export function voteProblem(bracket, { round, match, seed }) {
  const r = bracket.rounds.find((x) => x.round === round);
  if (!r) return 'No such round.';
  if (r.status !== 'open') return r.status === 'done' ? 'Voting on that round has closed.' : 'That round hasn’t started yet.';
  const m = r.matches[match];
  if (!m) return 'No such match.';
  if (seed !== m.a && seed !== m.b) return 'That song isn’t in this match.';
  return null;
}
