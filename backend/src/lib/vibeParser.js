// "Vibe search": turns a plain-English request like "cozy fantasy, under 13
// episodes, no romance, like Frieren" into structured filters that AniList
// can run (lib/vibeSearch.js). Pure and rule-based, no AI: a vocabulary of
// words mapped to ONE AniList genre or tag each (AniList's genre_in / tag_in
// are AND filters, so a word mapped to several tags would demand all of them),
// plus patterns for episode counts, formats, years, status, negation and
// "like <title>". Every recognised piece becomes a chip the UI shows back.

const G = (name) => ({ kind: 'genre', name });
const T = (name) => ({ kind: 'tag', name });

// Keys are matched as whole words, longest first. Tag names are AniList's own
// (checked against MediaTagCollection).
const VOCAB = {
  // genres
  action: G('Action'), adventure: G('Adventure'), comedy: G('Comedy'), funny: G('Comedy'), hilarious: G('Comedy'),
  drama: G('Drama'), dramatic: G('Drama'), fantasy: G('Fantasy'), horror: G('Horror'), scary: G('Horror'), creepy: G('Horror'),
  'magical girl': G('Mahou Shoujo'), 'mahou shoujo': G('Mahou Shoujo'), mecha: G('Mecha'), 'giant robots': G('Mecha'),
  music: G('Music'), musical: G('Music'), mystery: G('Mystery'), psychological: G('Psychological'),
  'mind-bending': G('Psychological'), 'mind bending': G('Psychological'), mindbending: G('Psychological'), 'mind-blowing': G('Psychological'),
  romance: G('Romance'), romantic: G('Romance'), 'love story': G('Romance'), 'sci-fi': G('Sci-Fi'), scifi: G('Sci-Fi'),
  'science fiction': G('Sci-Fi'), 'slice of life': G('Slice of Life'), sports: G('Sports'), sport: G('Sports'),
  supernatural: G('Supernatural'), thriller: G('Thriller'), suspense: G('Thriller'), ecchi: G('Ecchi'), fanservice: G('Ecchi'),
  // moods
  cozy: T('Iyashikei'), cosy: T('Iyashikei'), comfy: T('Iyashikei'), relaxing: T('Iyashikei'), chill: T('Iyashikei'),
  healing: T('Iyashikei'), calm: T('Iyashikei'), wholesome: T('Iyashikei'), heartwarming: T('Found Family'),
  sad: T('Tragedy'), tragic: T('Tragedy'), tearjerker: T('Tragedy'), dark: T('Tragedy'), darker: T('Tragedy'), gory: T('Gore'), bloody: T('Gore'),
  violent: T('Gore'), gore: T('Gore'), philosophical: T('Philosophy'), political: T('Politics'), surreal: T('Surreal Comedy'),
  episodic: T('Episodic'), parody: T('Parody'), satire: T('Satire'), 'coming of age': T('Coming of Age'),
  'found family': T('Found Family'), revenge: T('Revenge'), survival: T('Survival'), 'death game': T('Death Game'),
  // settings and themes
  isekai: T('Isekai'), 'another world': T('Isekai'), 'time travel': T('Time Manipulation'), 'time loop': T('Time Loop'),
  school: T('School'), 'high school': T('School'), space: T('Space'), cyberpunk: T('Cyberpunk'),
  'post-apocalyptic': T('Post-Apocalyptic'), apocalypse: T('Post-Apocalyptic'), dystopian: T('Dystopian'), dystopia: T('Dystopian'),
  historical: T('Historical'), history: T('Historical'), medieval: T('Medieval'), mythology: T('Mythology'),
  war: T('War'), military: T('Military'), detective: T('Detective'), crime: T('Crime'), mafia: T('Mafia'), yakuza: T('Yakuza'),
  magic: T('Magic'), vampire: T('Vampire'), vampires: T('Vampire'), demons: T('Demons'), dragons: T('Dragons'),
  samurai: T('Samurai'), ninja: T('Ninja'), pirates: T('Pirates'), zombie: T('Zombie'), zombies: T('Zombie'),
  ghosts: T('Ghost'), idols: T('Idol'), idol: T('Idol'), food: T('Food'), cooking: T('Food'), travel: T('Travel'),
  'road trip': T('Travel'), 'video games': T('Video Games'), gaming: T('Video Games'), 'martial arts': T('Martial Arts'),
  superhero: T('Superhero'), superheroes: T('Superhero'), 'super powers': T('Super Power'), superpowers: T('Super Power'),
  reincarnation: T('Reincarnation'), band: T('Band'), rural: T('Rural'), countryside: T('Rural'), camping: T('Camping'),
  'cute girls': T('Cute Girls Doing Cute Things'), cgdct: T('Cute Girls Doing Cute Things'), harem: T('Female Harem'),
  yuri: T('Yuri'), 'boys love': T("Boys' Love"), "boys' love": T("Boys' Love"), bl: T("Boys' Love"), tsundere: T('Tsundere'),
  'anti-hero': T('Anti-Hero'), antihero: T('Anti-Hero'), 'female lead': T('Female Protagonist'),
  'female protagonist': T('Female Protagonist'), 'adult cast': T('Primarily Adult Cast'), adults: T('Primarily Adult Cast'),
  baseball: T('Baseball'), basketball: T('Basketball'), volleyball: T('Volleyball'), soccer: T('Football'), football: T('Football'),
  tennis: T('Tennis'), boxing: T('Boxing'), swimming: T('Swimming'), cycling: T('Cycling'), racing: T('Cars'), cars: T('Cars'),
};
// Asking FOR fanservice isn't something the site helps with; asking to avoid it is.
const EXCLUDE_ONLY = new Set(['Ecchi']);

const TERMS = Object.keys(VOCAB).sort((a, b) => b.length - a.length);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NEGATION = '(?:no|without|not|non|avoid|minus|zero|skip|nothing)';
const STOPWORDS = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'with', 'of', 'in', 'on', 'for', 'to', 'some', 'something', 'anime',
  'show', 'shows', 'series', 'that', 'is', 'are', 'i', 'me', 'want', 'watch', 'looking', 'good', 'great', 'best', 'really', 'very',
  'please', 'recommend', 'recommendations', 'give', 'find', 'any', 'kind', 'vibe', 'vibes', 'feel', 'feeling', 'eps', 'episodes',
  'episode', 'from', 'set', 'would', "i'd", 'maybe', 'where', 'has', 'have', 'it', 'its', "it's", 'about', 'more', 'less', 'bit', 'lot', 'plenty', 'heavy', 'much', 'too', 'lots', 'one', 'like', 'similar']);

export function parseVibe(input, { now = new Date() } = {}) {
  let text = ` ${String(input || '').toLowerCase().replace(/[“”"]/g, ' ').replace(/\s+/g, ' ')} `;
  const out = {
    genres: [], tags: [], excludeGenres: [], excludeTags: [],
    minEpisodes: null, maxEpisodes: null, formats: [], yearFrom: null, yearTo: null, status: null,
    like: null, chips: [], unknown: [],
  };
  const take = (re, fn) => {
    text = text.replace(re, (...m) => { fn(...m); return ' '; });
  };
  const chip = (label, type = 'filter') => out.chips.push({ label, type });
  const year = now.getFullYear();

  // "like Frieren", "similar to Mushishi but darker": the title runs to the
  // next comma or connective. Taken first so its words aren't read as vibes.
  take(/(?:\bsimilar to|\bin the vein of|(?<!\bi |\bwould |\bi'd |\bd )\blike)\s+([^,;.!?]+?)(?=\s+(?:but|with|without|and|no|under|over|from|in the|set in|less than|more than)\b|[,;.!?]|\s*$)/, (_m, title) => {
    out.like = title.trim().replace(/\b\w/g, (c) => c.toUpperCase());
  });
  if (out.like) chip(`similar to ${out.like}`);

  // Episode counts. AniList's episode filters are exclusive, so bounds stay
  // inclusive here and vibeSearch widens them by one.
  take(/\b(?:under|less than|fewer than|below|at most|max(?:imum)?|up to|no more than)\s+(\d{1,4})\s*(?:eps?|episodes?)?\b/, (_m, n) => { out.maxEpisodes = Number(n); });
  take(/\b(\d{1,4})\s*(?:eps?|episodes?)\s*(?:or less|or fewer|max|tops)\b/, (_m, n) => { out.maxEpisodes = Number(n); });
  take(/\b(?:over|more than|at least|min(?:imum)?)\s+(\d{1,4})\s*(?:eps?|episodes?)\b/, (_m, n) => { out.minEpisodes = Number(n); });
  let short = false;
  take(/\b(?:short|one[- ]cour|quick|bingeable|binge-able|a weekend)\b/, () => { out.maxEpisodes ??= 13; short = true; });
  take(/\b(?:long(?:[- ]running)?|lengthy|epic length)\b/, () => { out.minEpisodes ??= 50; });

  // Formats.
  take(/\b(?:movies?|films?)\b/, () => out.formats.push('MOVIE'));
  take(/\b(?:tv series|tv shows?|tv)\b/, () => out.formats.push('TV'));
  take(/\bovas?\b/, () => out.formats.push('OVA'));
  out.formats = [...new Set(out.formats)];
  if (out.maxEpisodes != null) chip(`≤ ${out.maxEpisodes} episodes`);
  if (out.minEpisodes != null) chip(`≥ ${out.minEpisodes} episodes`);
  // "short" means a short series; a one-episode movie only if movies were asked for.
  if (short && out.minEpisodes == null && !out.formats.includes('MOVIE')) out.minEpisodes = 2;
  out.formats.forEach((f) => chip(f === 'MOVIE' ? 'movie' : f === 'TV' ? 'TV series' : f));

  // Years: decades, from/after/before, a bare year, recent/classic.
  take(/\b(?:from the |in the )?(19|20)?(\d)0'?s\b/, (_m, century, d) => {
    const start = Number(century ? `${century}${d}0` : (Number(d) >= 6 ? `19${d}0` : `20${d}0`));
    out.yearFrom = start;
    out.yearTo = start + 9;
  });
  take(/\b(?:after|since|newer than)\s+((?:19|20)\d{2})\b|\bfrom\s+((?:19|20)\d{2})\s+(?:on(?:wards?)?|and later|or later)\b/, (_m, a, b) => { out.yearFrom = Number(a || b); });
  take(/\b(?:before|older than|until|pre)\s*-?\s*((?:19|20)\d{2})\b/, (_m, y) => { out.yearTo = Number(y) - 1; });
  take(/\b(?:in\s+)?((?:19|20)\d{2})\b/, (_m, y) => { out.yearFrom = Number(y); out.yearTo = Number(y); });
  take(/\b(?:recent|new|newer|modern|latest)\b/, () => { out.yearFrom ??= year - 4; });
  take(/\b(?:old|older|classic|retro|oldschool|old-school)\b/, () => { out.yearTo ??= 2005; });
  if (out.yearFrom && out.yearTo) chip(out.yearFrom === out.yearTo ? `${out.yearFrom}` : `${out.yearFrom}–${out.yearTo}`);
  else if (out.yearFrom) chip(`${out.yearFrom} or later`);
  else if (out.yearTo) chip(`${out.yearTo} or earlier`);

  // Status.
  take(/\b(?:finished|completed|complete|ended|already over)\b/, () => { out.status = 'FINISHED'; });
  take(/\b(?:airing|ongoing|currently airing|this season)\b/, () => { out.status = 'RELEASING'; });
  if (out.status) chip(out.status === 'FINISHED' ? 'finished airing' : 'airing now');

  // Vocabulary, with negation ("no romance", "without too much gore").
  for (const term of TERMS) {
    const re = new RegExp(`(?:\\b${NEGATION}[\\s-]+(?:(?:too much|much|heavy|any|more)\\s+)?)?\\b${esc(term)}\\b`, 'g');
    text = text.replace(re, (match) => {
      const negated = new RegExp(`^\\s*${NEGATION}\\b`).test(match);
      const { kind, name } = VOCAB[term];
      if (!negated && EXCLUDE_ONLY.has(name)) return ' ';
      const list = negated ? (kind === 'genre' ? out.excludeGenres : out.excludeTags) : (kind === 'genre' ? out.genres : out.tags);
      if (!list.includes(name)) {
        list.push(name);
        chip(negated ? `no ${term}` : term, negated ? 'exclude' : 'include');
      }
      return ' ';
    });
  }

  out.unknown = text.split(/[^a-z0-9'-]+/).filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  return out;
}

export function isEmptyVibe(v) {
  return !v.genres.length && !v.tags.length && !v.excludeGenres.length && !v.excludeTags.length && v.minEpisodes == null
    && v.maxEpisodes == null && !v.formats.length && !v.yearFrom && !v.yearTo && !v.status && !v.like;
}
