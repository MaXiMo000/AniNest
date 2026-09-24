// Pure helpers behind GET /api/games/me/stats, kept free of the database so
// the streak arithmetic can be tested directly.

const DAY_MS = 86_400_000;

function dayIndex(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / DAY_MS);
}

// `results`: [{ date: 'YYYY-MM-DD', won: 0|1, rounds }] for one player.
// A streak counts consecutive UTC days with a WIN. The current streak is
// still alive if the last win was today or yesterday (today's puzzle may not
// be played yet).
export function dailyStats(results, today = new Date().toISOString().slice(0, 10)) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0 };
  let won = 0;
  const winDays = [];
  for (const r of results) {
    if (Number(r.won)) {
      won += 1;
      const rounds = Number(r.rounds);
      if (distribution[rounds] !== undefined) distribution[rounds] += 1;
      winDays.push(dayIndex(r.date));
    }
  }
  winDays.sort((a, b) => a - b);

  let longest = 0;
  let run = 0;
  let prev = null;
  for (const d of winDays) {
    run = prev !== null && d === prev + 1 ? run + 1 : (d === prev ? run : 1);
    longest = Math.max(longest, run);
    prev = d;
  }

  const todayIdx = dayIndex(today);
  let current = 0;
  if (prev !== null && todayIdx - prev <= 1) {
    const set = new Set(winDays);
    for (let d = prev; set.has(d); d -= 1) current += 1;
  }

  return {
    played: results.length,
    won,
    winRate: results.length ? Math.round((won / results.length) * 100) : 0,
    currentStreak: current,
    longestStreak: longest,
    distribution,
    // Last 35 days for the calendar strip: 'won' | 'lost' | null per day.
    calendar: Array.from({ length: 35 }, (_, i) => {
      const idx = todayIdx - 34 + i;
      const date = new Date(idx * DAY_MS).toISOString().slice(0, 10);
      const hit = results.find((r) => r.date === date);
      return { date, result: hit ? (Number(hit.won) ? 'won' : 'lost') : null };
    }),
  };
}
