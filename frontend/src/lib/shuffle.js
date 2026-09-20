// Fisher-Yates. Shared by every game that needs to shuffle a drawn pool
// (Higher/Lower, Guess the Anime, ...) rather than each re-implementing it.
export function shuffle(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
