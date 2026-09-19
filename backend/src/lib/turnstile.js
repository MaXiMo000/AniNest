// Cloudflare Turnstile (free bot-check widget) for the registration form.
// Rate limiting already blunts scripted abuse from a single IP, but a bot
// rotating IPs could still mass-register — Turnstile closes that gap without
// the user-hostility of a traditional CAPTCHA.
//
// Fully optional and safe by default: if TURNSTILE_SECRET_KEY isn't set
// (e.g. local dev, or you haven't signed up for a free key yet), verification
// is skipped entirely rather than blocking registration. Get free keys at
// https://dash.cloudflare.com/?to=/:account/turnstile

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export function isTurnstileEnabled() {
  return Boolean(process.env.TURNSTILE_SECRET_KEY);
}

export async function verifyTurnstile(token, remoteIp) {
  if (!isTurnstileEnabled()) return true;
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ secret: process.env.TURNSTILE_SECRET_KEY, response: token, remoteip: remoteIp }),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('[turnstile] verification request failed:', err.message);
    return false; // fail closed — an unverifiable request is treated as a failed check
  }
}
