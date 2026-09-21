// YouTube Data API v3 - admin-only search assist for finding an anime's
// official free-episode upload on a known licensed channel (Muse Asia,
// Ani-One Asia, Crunchyroll's own channel). Never called from the browser -
// proxied through our backend and gated by requireAdmin (see
// routes/adminWatchSources.js), same "never call a third-party API from the
// client" rule as every other integration in this app.
//
// Why admin-only: search.list costs 100 quota units against a 10,000/day
// free budget - shared across the whole deployment, not per-visitor - so at
// most ~100 searches/day total. Gating it behind requireAdmin keeps that
// tiny shared budget from being burned by ordinary traffic; the fallback
// once it's spent for the day is the public submission route
// (routes/animeWatchSources.js), which costs nothing and needs no API key.
import { cached } from './cache.js';

const BASE = 'https://www.googleapis.com/youtube/v3';

// Curated, hand-verified allowlist of officially-licensed free-episode
// channels (channel ids confirmed live against each channel's own page,
// not guessed) - search is always scoped to one of these via channelId, so
// results can never come from an arbitrary/unofficial uploader.
export const CURATED_CHANNELS = [
  { id: 'museasia', channelId: 'UCGbshtvS9t-8CW11W7TooQg', name: 'Muse Asia' },
  { id: 'anione', channelId: 'UC0wNSTMWIL3qaorLx0jie6A', name: 'Ani-One Asia' },
  { id: 'crunchyroll', channelId: 'UC6pGDc4bFGD1_36IKv3FnYg', name: 'Crunchyroll' },
];
const CHANNEL_BY_ID = new Map(CURATED_CHANNELS.map((c) => [c.id, c]));

export function isConfigured() {
  return Boolean(process.env.YOUTUBE_API_KEY);
}

function apiKeyOrThrow() {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    const err = new Error('YouTube search assist is not configured (YOUTUBE_API_KEY unset).');
    err.notConfigured = true;
    throw err;
  }
  return key;
}

async function youtubeGet(path, params) {
  const key = apiKeyOrThrow();
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set('key', key);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const reasons = (body?.error?.errors || []).map((e) => e.reason);
    const err = new Error(body?.error?.message || `YouTube API error ${res.status}`);
    err.status = res.status;
    err.quotaExceeded = reasons.includes('quotaExceeded') || reasons.includes('dailyLimitExceeded');
    throw err;
  }
  return res.json();
}

// Short cache (not the usual list/detail TTL shape - just enough to absorb
// an accidental double-click) since every call here costs real, scarce
// quota, unlike the rest of this app's keyless/generous-limit sources.
const SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;

export function searchOfficialChannel({ channelId, query, maxResults = 8 }) {
  const channel = CHANNEL_BY_ID.get(channelId);
  if (!channel) {
    const err = new Error('Unknown channel.');
    err.status = 400;
    throw err;
  }
  const key = `yt:search:${channelId}:${query}:${maxResults}`;
  return cached(key, SEARCH_CACHE_TTL_MS, async () => {
    const json = await youtubeGet('/search', {
      part: 'snippet',
      channelId: channel.channelId,
      q: query,
      type: 'video',
      maxResults: String(maxResults),
      order: 'relevance',
    });
    return (json.items || []).map((item) => ({
      videoId: item.id?.videoId,
      title: item.snippet?.title || 'Untitled',
      thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
      publishedAt: item.snippet?.publishedAt || null,
      channelName: channel.name,
    })).filter((r) => r.videoId);
  });
}

function findChannelOrThrow(channelId) {
  const channel = CHANNEL_BY_ID.get(channelId);
  if (!channel) {
    const err = new Error('Unknown channel.');
    err.status = 400;
    throw err;
  }
  return channel;
}

// Enumerates what a channel has ACTUALLY uploaded, for bulk-curation - a
// completely different (and vastly cheaper) approach from
// searchOfficialChannel above: channels.list + playlistItems.list cost 1
// unit per call each (vs. search.list's 100), so listing a channel's
// entire upload history costs only a few units total, not "100 units per
// guessed title". This is what backs the admin page's "Import from
// channel" bulk action - see routes/adminWatchSources.js and
// lib/watchSourceMatcher.js for how titles get matched to a MAL id before
// anything is inserted.
export async function listChannelUploads(channelId, { maxItems = 200 } = {}) {
  const channel = findChannelOrThrow(channelId);
  return cached(`yt:uploads:${channelId}:${maxItems}`, SEARCH_CACHE_TTL_MS, async () => {
    const channelInfo = await youtubeGet('/channels', { part: 'contentDetails', id: channel.channelId });
    const uploadsPlaylistId = channelInfo.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
    if (!uploadsPlaylistId) return [];

    const videos = [];
    let pageToken = '';
    while (videos.length < maxItems) {
      const json = await youtubeGet('/playlistItems', {
        part: 'snippet',
        playlistId: uploadsPlaylistId,
        maxResults: '50',
        ...(pageToken ? { pageToken } : {}),
      });
      for (const item of json.items || []) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (!videoId) continue;
        videos.push({
          videoId,
          title: item.snippet?.title || 'Untitled',
          thumbnail: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
          publishedAt: item.snippet?.publishedAt || null,
          channelName: channel.name,
        });
      }
      pageToken = json.nextPageToken;
      if (!pageToken) break;
    }
    return videos.slice(0, maxItems);
  });
}
