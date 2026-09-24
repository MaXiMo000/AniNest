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
    if (/^\/api\/games\/[^/]+\/leaderboard$/.test(p)) return json(route, { leaderboard: [{ username: 'alice', best_streak: 12 }], myRank: null, myBest: null });
    if (/^\/api\/games\/[^/]+\/start$/.test(p)) return json(route, { runId: 'a'.repeat(32) }, 201);
    if (/^\/api\/games\/[^/]+\/score$/.test(p)) return json(route, { best: 1 });
    if (p.endsWith('/result')) return json(route, { recorded: true });
    return json(route, {});
  });
}
