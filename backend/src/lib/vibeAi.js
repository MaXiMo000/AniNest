import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { GENRE_NAMES, TAG_NAMES, EXCLUDE_ONLY } from './vibeParser.js';
import { cached } from './cache.js';
import { logger } from './logger.js';

// Vibe search v2 (optional): when the rule-based reader (lib/vibeParser.js)
// leaves words it didn't understand, Claude Haiku reads the whole request into
// the same filter shape. Off unless ANTHROPIC_API_KEY is set. Any failure,
// timeout or spent daily budget falls back to v1, so search never breaks.

const MODEL = 'claude-haiku-4-5';
const DAILY_LIMIT = Number(process.env.VIBE_AI_DAILY_LIMIT) || 500;
const TIMEOUT_MS = 8000;

// Plain strings on the wire: the SDK's schema helper can only hint at enums,
// so the allowed names go in the prompt and toVibe below keeps only those
// (all real AniList genres and tags) and re-checks every bound.
const Year = z.number().int().nullable();
const VibeFilters = z.object({
  genres: z.array(z.string()),
  tags: z.array(z.string()),
  excludeGenres: z.array(z.string()),
  excludeTags: z.array(z.string()),
  minEpisodes: z.number().int().nullable(),
  maxEpisodes: z.number().int().nullable(),
  formats: z.array(z.string()),
  yearFrom: Year,
  yearTo: Year,
  status: z.string().nullable(),
  like: z.string().nullable(),
});
const GENRES = new Set(GENRE_NAMES);
const TAGS = new Set(TAG_NAMES);
const FORMATS = new Set(['TV', 'MOVIE', 'OVA']);
const STATUSES = new Set(['FINISHED', 'RELEASING']);

const SYSTEM = `You turn a request for anime recommendations into search filters for AniList.
Use only genre and tag names from the allowed lists. Pick the fewest that capture the request: every genre and tag is required in each result, so an extra one narrows the results a lot.
Put things the person wants to avoid in excludeGenres/excludeTags.
"like <title>" or "similar to <title>" goes in like, as the title only; otherwise like is null.
Episode counts are inclusive. "short" means at most 13 episodes. Leave anything the request doesn't mention empty or null.
formats: any of TV, MOVIE, OVA. status: FINISHED, RELEASING or null.
Allowed genres: ${GENRE_NAMES.join(', ')}.
Allowed tags: ${TAG_NAMES.join(', ')}.
Current year: ${new Date().getFullYear()}.`;

let client = null;
let reader = null;
if (process.env.ANTHROPIC_API_KEY) {
  client = new Anthropic({ timeout: TIMEOUT_MS, maxRetries: 1 });
  reader = async (query) => {
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: query }],
      output_config: { format: zodOutputFormat(VibeFilters) },
    });
    if (response.stop_reason !== 'end_turn' || !response.parsed_output) return null;
    return response.parsed_output;
  };
}

export const vibeAiEnabled = () => Boolean(reader);

// Test hook: a fake reader turns v2 on without an API key; null turns it off.
export function setVibeReader(fn) {
  reader = fn;
}

let day = '';
let used = 0;
function spend() {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== day) { day = today; used = 0; }
  if (used >= DAILY_LIMIT) return false;
  used += 1;
  return true;
}

const clampInt = (n, lo, hi) => (n == null || n < lo || n > hi ? null : n);

// The model's filters in the same shape parseVibe returns, with chips.
export function toVibe(raw, query) {
  const f = VibeFilters.parse(raw);
  const year = new Date().getFullYear() + 1;
  const only = (list, allowed) => [...new Set(list)].filter((x) => allowed.has(x));
  const v = {
    genres: only(f.genres, GENRES).filter((g) => !EXCLUDE_ONLY.has(g)),
    tags: only(f.tags, TAGS),
    excludeGenres: only(f.excludeGenres, GENRES),
    excludeTags: only(f.excludeTags, TAGS),
    minEpisodes: clampInt(f.minEpisodes, 1, 5000),
    maxEpisodes: clampInt(f.maxEpisodes, 1, 5000),
    formats: only(f.formats, FORMATS),
    yearFrom: clampInt(f.yearFrom, 1917, year),
    yearTo: clampInt(f.yearTo, 1917, year),
    status: STATUSES.has(f.status) ? f.status : null,
    like: f.like ? f.like.trim().slice(0, 100) || null : null,
    chips: [],
    unknown: [],
  };
  // A title the person didn't actually write is the model guessing; drop it.
  if (v.like && !String(query).toLowerCase().includes(v.like.toLowerCase().split(/\s+/)[0])) v.like = null;
  const chip = (label, type = 'filter') => v.chips.push({ label, type });
  if (v.like) chip(`similar to ${v.like}`);
  if (v.maxEpisodes != null) chip(`≤ ${v.maxEpisodes} episodes`);
  if (v.minEpisodes != null) chip(`≥ ${v.minEpisodes} episodes`);
  v.formats.forEach((x) => chip(x === 'MOVIE' ? 'movie' : x === 'TV' ? 'TV series' : x));
  if (v.yearFrom && v.yearTo) chip(v.yearFrom === v.yearTo ? `${v.yearFrom}` : `${v.yearFrom}–${v.yearTo}`);
  else if (v.yearFrom) chip(`${v.yearFrom} or later`);
  else if (v.yearTo) chip(`${v.yearTo} or earlier`);
  if (v.status) chip(v.status === 'FINISHED' ? 'finished airing' : 'airing now');
  [...v.genres, ...v.tags].forEach((x) => chip(x, 'include'));
  [...v.excludeGenres, ...v.excludeTags].forEach((x) => chip(`no ${x}`, 'exclude'));
  return v;
}

// null means "use v1". Kept in the in-memory LRU (free text must not grow the
// database cache), so a repeated search costs nothing for a day.
export async function aiParseVibe(query) {
  if (!reader) return null;
  const key = `vibe-ai:${query.trim().toLowerCase().replace(/\s+/g, ' ')}`;
  try {
    const raw = await cached(key, 24 * 3600 * 1000, async () => {
      if (!spend()) throw new Error('daily vibe AI budget spent');
      const out = await reader(query);
      if (!out) throw new Error('no filters returned');
      return out;
    });
    return toVibe(raw, query);
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) logger.warn('vibe AI rate limited - using the rule-based reader');
    else if (err instanceof Anthropic.APIError) logger.warn({ status: err.status }, 'vibe AI request failed - using the rule-based reader');
    else logger.warn({ err: err?.message }, 'vibe AI unavailable - using the rule-based reader');
    return null;
  }
}
