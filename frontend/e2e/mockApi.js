// A fake AniNest backend for browser tests. Every request to the API origin
// is answered from here, deterministically.

const GENRES = ['Action', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Slice of Life', 'Mystery', 'Sports', 'Horror', 'Adventure', 'Psychological', 'Mecha', 'Music', 'Supernatural', 'Thriller'];
const STUDIOS = ['MAPPA', 'Madhouse', 'Bones', 'Kyoto Animation', 'Wit Studio', 'Sunrise', 'Production I.G', 'ufotable'];
const SOURCES = ['Manga', 'Light Novel', 'Original', 'Visual Novel', 'Web Manga', 'Novel', 'Video Game'];
const COLORS = ['#ff2d78', '#00d9ff', '#ffd23f', '#17e8a0', '#7b2ff7', '#ff7a1a'];

function cover(i) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="${COLORS[i % COLORS.length]}"/><text x="20" y="160" font-size="40">#${i}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export const POOL = Array.from({ length: 60 }, (_, k) => {
  const i = k + 1;
  const img = cover(i);
  return {
    mal_id: 1000 + i,
    title: `Test Anime ${String.fromCharCode(65 + (k % 26))}${i}`,
    type: i % 7 === 0 ? 'Movie' : 'TV',
    episodes: 1 + ((i * 7) % 60),
    score: Math.round((6 + (i % 35) / 10) * 10) / 10,
    members: 10000 * i,
    year: 1990 + (i % 35),
    synopsis: `This is the synopsis for mystery show number ${i}. A long enough description so the game accepts it as a real clue for players.`,
    genres: [{ mal_id: (i % 16) + 1, name: GENRES[i % GENRES.length] }, { mal_id: ((i + 3) % 16) + 1, name: GENRES[(i + 3) % GENRES.length] }],
    studios: [{ name: STUDIOS[i % STUDIOS.length] }],
    source: SOURCES[i % SOURCES.length],
    images: { jpg: { image_url: img, large_image_url: img }, webp: { image_url: img, large_image_url: img } },
  };
});

const MANGA = Array.from({ length: 30 }, (_, k) => ({
  id: `00000000-0000-4000-8000-${String(k + 1).padStart(12, '0')}`,
  title: `Test Manga ${k + 1}`,
}));

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true', 'x-csrf-token': 'test' } });
}

// `user`: null for a logged-out visitor, or { username } for a signed-in one.
export async function mockApi(page, { user = null } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  const hl = { field: 'score', at: 0, streak: 0, skips: 1 };
  const rounds = { game: null, input: 'choices', k: 0, streak: 0, lives: 3, skips: 3 };
  // Opening clips: answered here (a fast 404, so the player shows its
  // "won't load" state) instead of reaching the real AnimeThemes CDN, whose
  // speed and reachability vary between machines.
  await page.route('https://v.animethemes.moe/**', (route) => route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }));
  await page.route('http://localhost:8787/**', (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') {
      return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': 'http://localhost:5199', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type,x-csrf-token', 'access-control-allow-methods': 'GET,POST,PUT,DELETE' } });
    }
    const url = new URL(req.url());
    const p = url.pathname;
    if (p === '/api/auth/me') return json(route, { user: user ? { id: 1, ...user } : null });
    if (p === '/api/favorites') return json(route, { favorites: [] });
    if (p === '/api/manga-favorites') return json(route, { favorites: [] });
    if (p.startsWith('/api/lists/')) return json(route, { lists: [] });
    if (p === '/api/notifications/unread-count') return json(route, { unread: 0 });
    if (p.startsWith('/api/notifications')) return json(route, { count: 0, notifications: [] });
    if (p === '/api/anime/top' || p === '/api/anime/season/now' || p === '/api/anime/search') {
      const page = Number(url.searchParams.get('page') || 1);
      return json(route, { data: page === 1 ? POOL : [] });
    }
    if (/^\/api\/anime\/\d+\/themes$/.test(p)) {
      return json(route, { data: [{ slug: 'OP1', type: 'OP', title: 'Test Song', videoUrl: 'https://v.animethemes.moe/test.webm' }] });
    }
    if (/^\/api\/anime\/\d+\/characters$/.test(p)) {
      return json(route, { data: [1, 2, 3, 4].map((n) => ({ role: n < 3 ? 'Main' : 'Supporting', character: { name: `Character ${n}` } })) });
    }
    if (p === '/api/games/daily') {
      const a = POOL[3];
      return json(route, { date: today, puzzleNumber: 7, answer: { mal_id: a.mal_id, title: a.title, image: a.images.jpg.image_url, synopsis: a.synopsis, score: a.score } });
    }
    if (p === '/api/games/manga-daily') {
      return json(route, {
        date: today,
        puzzleNumber: 1,
        answer: { id: MANGA[0].id, title: MANGA[0].title, image: null, synopsis: 'A manga synopsis long enough to be a real clue for the daily manga puzzle.', year: 2011, tags: ['Action', 'Drama'] },
        distractors: MANGA.slice(1, 13),
      });
    }
    if (p === '/api/users/tester') {
      return json(route, {
        user: { username: 'tester', createdAt: '2026-01-01 00:00:00' },
        favorites: POOL.slice(0, 12).map((a, i) => ({
          mal_id: a.mal_id, title: a.title, image: a.images.jpg.image_url, score: a.score, type: a.type,
          status: ['completed', 'watching', 'plan_to_watch', 'dropped', null][i % 5], genres: a.genres.map((g) => g.name), episodes: a.episodes,
        })),
        reviews: [],
        mangaReviews: [],
        badges: [{ id: 'variety-bronze', tier: 'bronze', emoji: '🕹️', label: 'Game Hopper', desc: 'Scored in 3+ different games' }],
        xp: { total: 120, level: 2, levelStart: 50, nextLevelAt: 200, progress: 0.47, title: 'Newbie Nakama', breakdown: [] },
      });
    }
    if (p === '/api/games/me/stats') return json(route, { games: {}, daily: { played: 0, won: 0, winRate: 0, currentStreak: 0, longestStreak: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0 }, calendar: [] }, mangaDaily: { played: 0, won: 0, winRate: 0, currentStreak: 0, longestStreak: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0 }, calendar: [] } });
    // Round games are dealt by the server: a stand-in that walks POOL in
    // order. The right answer is always the round's own show / value.
    if (/^\/api\/games\/rounds\/[^/]+\/cover$/.test(p)) return route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="300"><rect width="200" height="300" fill="#7b2ff7"/></svg>' });
    if (p === '/api/games/rounds/start' || /^\/api\/games\/rounds\/[^/]+\/(answer|skip|finish)$/.test(p)) {
      const body = JSON.parse(req.postData() || '{}');
      const a = (k) => POOL[k % POOL.length];
      const titleChoices = (k) => [0, 1, 2, 3].map((d) => ({ id: String(a(k + d).mal_id), label: a(k + d).title }));
      const build = (k) => {
        const s = a(k);
        switch (rounds.game) {
          case 'studio-match': return { view: { anime: { title: s.title, image: s.images.jpg.image_url }, choices: STUDIOS.slice(0, 4).map((x) => ({ id: x, label: x })) }, answer: STUDIOS[(k + 1) % 4] };
          case 'source-guess': return { view: { anime: { title: s.title, image: s.images.jpg.image_url }, choices: SOURCES.slice(0, 4).map((x) => ({ id: x, label: x })) }, answer: SOURCES[(k + 1) % 4] };
          case 'emoji-plot': return { view: { emoji: '🍥🦊', choices: titleChoices(k) }, answer: String(s.mal_id) };
          case 'cast-call': return { view: { cast: [{ name: 'Character 1', va: 'VA 1' }, { name: 'Character 2', va: null }], choices: titleChoices(k) }, answer: String(s.mal_id) };
          case 'name-that-opening': return { view: { videoUrl: 'https://v.animethemes.moe/test.webm', choices: titleChoices(k) }, answer: String(s.mal_id) };
          case 'timeline': {
            const cards = [0, 1, 2, 3].map((d) => a(k + d * 5));
            return { view: { cards: cards.map((c) => ({ id: String(c.mal_id), title: c.title, image: c.images.jpg.image_url })) }, answer: Object.fromEntries(cards.map((c) => [c.mal_id, c.year])) };
          }
          default: return {
            view: {
              cover: `/api/games/rounds/${'c'.repeat(32)}/cover?r=${k}`,
              clues: { synopsis: s.synopsis, genres: s.genres.map((g) => g.name), type: s.type, episodes: s.episodes, year: s.year, studio: s.studios[0].name, source: s.source },
              ...(rounds.input === 'typed' ? {} : { choices: titleChoices(k) }),
            },
            answer: String(s.mal_id),
            anime: s,
          };
        }
      };
      const view = () => ({ runId: 'c'.repeat(32), game: rounds.game, streak: rounds.streak, lives: rounds.lives, msLeft: rounds.game === 'gta-blitz' ? 60_000 : null, skipsLeft: rounds.skips, round: { no: rounds.k + 1, ...build(rounds.k).view } });
      if (p === '/api/games/rounds/start') {
        Object.assign(rounds, { game: body.game, input: body.input || 'choices', k: 0, streak: 0, lives: body.game === 'gta-blitz' ? null : 3, skips: 3 });
        return json(route, { ...view(), ...(rounds.input === 'typed' ? { titles: POOL.map((x) => x.title) } : {}) }, 201);
      }
      if (p.endsWith('/skip')) { rounds.skips -= 1; rounds.k += 1; return json(route, view()); }
      if (p.endsWith('/finish')) return json(route, { gameOver: true, timeUp: true, streak: rounds.streak, reveal: {}, recap: { label: 'x', href: null } });
      const cur = build(rounds.k);
      let correct;
      if (rounds.game === 'timeline') {
        const years = (body.order || []).map((id) => cur.answer[id]);
        correct = years.every((y, i) => i === 0 || years[i - 1] <= y);
      } else if (body.typed != null && !body.giveUp) {
        correct = body.typed.toLowerCase() === cur.anime.title.toLowerCase();
        if (!correct && rounds.lives > 1) { rounds.lives -= 1; return json(route, { correct: false, retry: true, streak: rounds.streak, lives: rounds.lives, gameOver: false }); }
      } else {
        correct = !body.giveUp && String(body.answer) === String(cur.answer);
      }
      const reveal = rounds.game === 'timeline' ? { years: cur.answer } : { text: cur.anime?.title || String(cur.answer), title: POOL[rounds.k % POOL.length].title, mal_id: POOL[rounds.k % POOL.length].mal_id };
      const done = { solution: cur.answer, reveal, recap: { label: `Round ${rounds.k + 1}`, href: null } };
      if (correct) rounds.streak += 1; else if (rounds.lives != null) rounds.lives -= 1;
      if (rounds.lives === 0 || (rounds.game === 'gta-blitz' && rounds.k >= 5)) return json(route, { ...done, correct, streak: rounds.streak, lives: rounds.lives, gameOver: true });
      rounds.k += 1;
      return json(route, { ...done, correct, streak: rounds.streak, lives: rounds.lives, gameOver: false, next: view() });
    }
    // Higher or Lower is dealt by the server: a tiny stand-in that walks POOL
    // in order and judges with the same tie-wins rule.
    if (p === '/api/games/hl/start' || /^\/api\/games\/hl\/[^/]+\/(guess|skip)$/.test(p)) {
      const hlValue = { 'higher-lower': 'score', 'hl-popularity': 'members', 'hl-episodes': 'episodes', 'hl-year': 'year' };
      const card = (i, withValue) => {
        const a = POOL[i % POOL.length];
        return { mal_id: a.mal_id, title: a.title, image: a.images.jpg.image_url, ...(withValue ? { value: a[hl.field] } : {}) };
      };
      const view = () => ({ runId: 'b'.repeat(32), streak: hl.streak, skipsLeft: hl.skips, champion: card(hl.at, true), challenger: card(hl.at + 1, false) });
      if (p === '/api/games/hl/start') {
        hl.field = hlValue[JSON.parse(req.postData() || '{}').game] || 'score';
        Object.assign(hl, { at: 0, streak: 0, skips: 1 });
        return json(route, view(), 201);
      }
      if (p.endsWith('/skip')) { hl.skips -= 1; hl.at += 1; return json(route, view()); }
      const { direction } = JSON.parse(req.postData() || '{}');
      const champ = POOL[hl.at % POOL.length][hl.field];
      const value = POOL[(hl.at + 1) % POOL.length][hl.field];
      const correct = direction === 'higher' ? value >= champ : value <= champ;
      if (!correct) return json(route, { correct, value, streak: hl.streak, gameOver: true });
      hl.at += 1;
      hl.streak += 1;
      return json(route, { correct, value, streak: hl.streak, gameOver: false, next: view() });
    }
    if (/^\/api\/games\/[^/]+\/leaderboard$/.test(p)) return json(route, { leaderboard: [{ username: 'alice', best_streak: 12 }], myRank: null, myBest: null });
    if (/^\/api\/games\/[^/]+\/start$/.test(p)) return json(route, { runId: 'a'.repeat(32) }, 201);
    if (/^\/api\/games\/[^/]+\/score$/.test(p)) return json(route, { best: 1 });
    if (p.endsWith('/result')) return json(route, { recorded: true });
    return json(route, {});
  });
}
