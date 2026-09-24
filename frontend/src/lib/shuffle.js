import { shuffleWith } from './rng.js';

// Fisher-Yates. Shared by every game that needs to shuffle a drawn pool
// (Higher/Lower, Guess the Anime, ...) rather than each re-implementing it.
// Pass `rand` (see rng.js) for a repeatable, seeded shuffle.
export function shuffle(list, rand = Math.random) {
  return shuffleWith(list, rand);
}
