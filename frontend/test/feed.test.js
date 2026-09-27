import { describe, it, expect } from 'vitest';
import { feedItemText } from '../src/pages/feed.js';

describe('feedItemText', () => {
  it('says what happened for each kind', () => {
    expect(feedItemText({ kind: 'review', title: 'Frieren', rating: 9, mal_id: 1 })).toEqual(['⭐', 'rated Frieren 9/10']);
    expect(feedItemText({ kind: 'status', status: 'completed', title: 'Frieren', mal_id: 1 })).toEqual(['✅', 'completed Frieren']);
    expect(feedItemText({ kind: 'status', status: 'watching', title: 'Frieren', mal_id: 1 })).toEqual(['👀', 'started watching Frieren']);
    expect(feedItemText({ kind: 'added', title: 'Frieren', mal_id: 1 })).toEqual(['💖', 'added Frieren to their list']);
  });
  it('falls back to the id when the title is unknown', () => {
    expect(feedItemText({ kind: 'review', title: null, rating: 7, mal_id: 42 })).toEqual(['⭐', 'rated Anime #42 7/10']);
  });
});
