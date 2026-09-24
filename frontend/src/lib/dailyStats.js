// Frontend twin of backend/src/lib/gameStats.js's dailyStats(), used for
// visitors who aren't signed in (their results live only in localStorage).
// Signed-in players get the same shape from GET /api/games/me/stats.

const DAY_MS = 86_400_000;
const dayIndex = (iso) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY_MS);

export function dailyStats(results, today = new Date().toISOString().slice(0, 10)) {
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0 };
  const winDays = [];
  let won = 0;
  for (const r of results) {
    if (!r.won) continue;
    won += 1;
    if (distribution[r.rounds] !== undefined) distribution[r.rounds] += 1;
    winDays.push(dayIndex(r.date));
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
  const byDate = new Map(results.map((r) => [r.date, r]));
  return {
    played: results.length,
    won,
    winRate: results.length ? Math.round((won / results.length) * 100) : 0,
    currentStreak: current,
    longestStreak: longest,
    distribution,
    calendar: Array.from({ length: 35 }, (_, i) => {
      const date = new Date((todayIdx - 34 + i) * DAY_MS).toISOString().slice(0, 10);
      const hit = byDate.get(date);
      return { date, result: hit ? (hit.won ? 'won' : 'lost') : null };
    }),
  };
}

// Every result saved under `prefix` + date in localStorage.
export function localDailyResults(prefix) {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const date = key.slice(prefix.length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const r = JSON.parse(localStorage.getItem(key));
      if (r?.attempts) out.push({ date, won: Boolean(r.won), rounds: r.attempts.length });
    }
  } catch { /* storage blocked */ }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
