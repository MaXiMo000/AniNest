// Franchise clusters and their automatic release-order watch guide, built
// from AniList's typed relations. Pure: the walker takes the fetch function
// as an argument, so the tests drive it with fixture graphs instead of the
// live API. Storage and rate-limit pacing live in lib/franchiseStore.js.
//
// Direction matters: an edge A -> B typed T reads "B is A's T". So an edge
// typed SIDE_STORY pointing at B makes B a side story; SEQUEL makes B a sequel.

// Relations that stay inside one franchise. CHARACTER (a crossover cameo),
// OTHER, ADAPTATION and SOURCE (the manga) would drag in unrelated shows.
const FOLLOW = new Set(['SEQUEL', 'PREQUEL', 'PARENT', 'SIDE_STORY', 'SPIN_OFF', 'SUMMARY', 'ALTERNATIVE', 'COMPILATION', 'CONTAINS']);
// Formats that can be the main story. Specials, OVAs and music videos can't.
const MAIN_FORMATS = new Set(['TV', 'TV_SHORT', 'MOVIE', 'ONA']);
const RECAP = ['SUMMARY', 'COMPILATION'];
const BRANCH = ['SPIN_OFF', 'SIDE_STORY'];

export const LIMITS = { maxNodes: 80, maxRequests: 12 };

// Promotional clips AniList lists as specials ("Bakemonogatari PV").
const PROMO = /\b(PVs?|CMs?|Teasers?|Trailers?)\b/;
const isPromo = (m) => (m.format === 'SPECIAL' || !m.format) && PROMO.test(`${m.title?.romaji || ''} ${m.title?.english || ''}`);

// Breadth-first, one AniList request per layer (up to 50 ids each), so a
// franchise costs a handful of requests. `truncated` says a cap was hit.
export async function walkFranchise(fetchMedia, rootMalId, { maxNodes = LIMITS.maxNodes, maxRequests = LIMITS.maxRequests } = {}) {
  const nodes = new Map();
  const queued = new Set();
  const pending = [];
  let requests = 0;
  let batch = { malIds: [rootMalId] };
  let truncated = false;

  for (;;) {
    requests += 1;
    const media = await fetchMedia(batch);
    for (const m of media) {
      if (!m || nodes.has(m.id) || m.isAdult || m.format === 'MUSIC' || isPromo(m)) continue;
      if (nodes.size >= maxNodes) { truncated = true; break; }
      nodes.set(m.id, m);
      queued.add(m.id);
      for (const edge of m.relations?.edges || []) {
        const id = edge.node?.id;
        if (edge.node?.type !== 'ANIME' || !FOLLOW.has(edge.relationType) || queued.has(id)) continue;
        queued.add(id);
        pending.push(id);
      }
    }
    if (!pending.length || truncated) break;
    if (requests >= maxRequests || nodes.size >= maxNodes) { truncated = true; break; }
    batch = { ids: pending.splice(0, 50) }; // anything past 50 waits for the next request
  }
  return { nodes: [...nodes.values()], truncated };
}

function dateKey(d) {
  if (!d?.year) return null;
  const pad = (n) => String(n || 1).padStart(2, '0');
  return `${d.year}-${pad(d.month)}-${pad(d.day)}`;
}

function titleOf(m) {
  return m.title?.english || m.title?.romaji || 'Untitled';
}

// Turns walked nodes into ordered entries with a default tier:
//   essential   main-format entries on a sequel/prequel chain that isn't a spin-off
//   optional    side stories, spin-off chains, OVAs and specials
//   skip        recaps and compilation movies
// `alt` marks an alternative version (FMA 2003 vs Brotherhood). These are
// defaults: community-voted orders (ROADMAP Phase 7) refine them.
// Returns null for a lone show, which has no franchise to guide.
export function buildFranchise(nodes) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = new Map(nodes.map((n) => [n.id, new Set()]));
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (id) => {
    while (parent.get(id) !== id) id = parent.get(id);
    return id;
  };

  for (const n of nodes) {
    for (const edge of n.relations?.edges || []) {
      const target = edge.node?.id;
      if (!byId.has(target) || target === n.id) continue;
      incoming.get(target).add(edge.relationType);
      // Sequel/prequel links form "chains": one storyline across seasons.
      if (edge.relationType === 'SEQUEL' || edge.relationType === 'PREQUEL') parent.set(find(target), find(n.id));
    }
  }

  // A chain is a branch when any member was reached as a spin-off or side
  // story, so all of Prisma Illya's seasons follow its first one.
  const branchChains = new Set();
  for (const n of nodes) {
    if (BRANCH.some((t) => incoming.get(n.id).has(t))) branchChains.add(find(n.id));
  }

  const isRecap = (n) => {
    const types = incoming.get(n.id);
    return RECAP.some((t) => types.has(t)) && !['SEQUEL', 'PREQUEL', 'CONTAINS'].some((t) => types.has(t));
  };

  const entries = nodes.map((n) => {
    let tier = 'optional';
    if (isRecap(n)) tier = 'skip';
    else if (MAIN_FORMATS.has(n.format) && !branchChains.has(find(n.id))) tier = 'essential';
    return {
      anilist_id: n.id,
      mal_id: n.idMal || null,
      title: titleOf(n),
      image: n.coverImage?.large || null,
      format: n.format || null,
      episodes: n.episodes ?? null,
      start_date: dateKey(n.startDate),
      tier,
      alt: incoming.get(n.id).has('ALTERNATIVE') && !['SEQUEL', 'PREQUEL'].some((t) => incoming.get(n.id).has(t)),
      chain: find(n.id),
    };
  });
  if (entries.length < 2) return null;

  // Release order; undated (announced) entries last, TV before a same-day movie.
  const formatRank = (f) => (f === 'TV' ? 0 : f === 'MOVIE' ? 1 : 2);
  entries.sort((a, b) => {
    if (a.start_date !== b.start_date) {
      if (!a.start_date) return 1;
      if (!b.start_date) return -1;
      return a.start_date < b.start_date ? -1 : 1;
    }
    return formatRank(a.format) - formatRank(b.format) || a.anilist_id - b.anilist_id;
  });

  // Every chain was a branch (e.g. only spin-offs were reachable): promote the
  // earliest main-format chain so the guide always has a spine.
  if (!entries.some((e) => e.tier === 'essential')) {
    const first = entries.find((e) => MAIN_FORMATS.has(e.format) && e.tier !== 'skip');
    if (first) entries.forEach((e) => { if (e.chain === first.chain && e.tier !== 'skip' && MAIN_FORMATS.has(e.format)) e.tier = 'essential'; });
  }

  const named = entries.find((e) => e.tier === 'essential') || entries[0];
  return { name: named.title, entries: entries.map(({ chain: _chain, ...e }) => e) };
}

export function slugify(text) {
  return String(text)
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '') || 'franchise';
}
