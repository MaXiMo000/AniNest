// Server-side Jikan client. Because this queue lives on the backend instead
// of in each visitor's browser, ALL visitors to the site share a single
// ~3 req/s pacer against Jikan's public rate limit — one busy afternoon of
// traffic no longer multiplies into one Jikan request-budget per tab.

const BASE = 'https://api.jikan.moe/v4';
const MIN_GAP_MS = 500;

let queue = Promise.resolve();
let lastCallAt = 0;

function scheduled(fn) {
  const run = () => {
    const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastCallAt));
    return new Promise((resolve) => setTimeout(resolve, wait)).then(() => {
      lastCallAt = Date.now();
      return fn();
    });
  };
  queue = queue.then(run, run);
  return queue;
}

export async function jikanGet(path, params = {}) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  });

  return scheduled(async () => {
    let attempt = 0;
    for (;;) {
      const res = await fetch(url.toString());
      if ((res.status === 429 || res.status >= 500) && attempt < 2) {
        attempt += 1;
        await new Promise((r) => setTimeout(r, 700 * attempt));
        continue;
      }
      if (!res.ok) {
        const err = new Error(`Jikan error ${res.status} on ${path}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    }
  });
}
