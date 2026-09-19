# Deploying AniNest to Render

`render.yaml` at the repo root defines both services as a Blueprint, so the easiest path is:

1. Push this repo to GitHub.
2. **Create a free database at [turso.tech](https://turso.tech) first** — Render's free-tier web services can't attach a persistent disk at all (confirmed directly: the Blueprint validator rejects a `disk:` block on the free plan), so the database lives on Turso instead. After signing up:
   ```bash
   turso db create aninest
   turso db show aninest --url        # -> TURSO_DATABASE_URL
   turso db tokens create aninest     # -> TURSO_AUTH_TOKEN
   ```
3. In the Render dashboard: **New → Blueprint**, point it at the repo. Render reads `render.yaml` and creates both services, prompting for the `sync: false` values before creating anything:
   - `TURSO_DATABASE_URL` / `TURSO_AUTH_TOKEN` — paste the values from step 2.
4. **First deploy will fail to talk cross-service** — that's expected. Render assigns each service's `*.onrender.com` URL only after it exists, so `FRONTEND_ORIGIN` (on the backend) and `VITE_API_URL` (on the frontend) are placeholders in `render.yaml` until you fill in the real ones:
   - Open **aninest-backend → Environment**, set `FRONTEND_ORIGIN` to the actual frontend URL Render assigned.
   - Open **aninest-frontend → Environment**, set `VITE_API_URL` to the actual backend URL Render assigned, then trigger a manual redeploy of the frontend (env vars are baked in at build time for a static site, so changing one requires a rebuild).

## Things that don't come from the Blueprint automatically

- **`SESSION_SECRET`**: `generateValue: true` makes Render create a random one on first deploy — good, don't overwrite it with the value from your local `.env`. If you ever need to force-logout everyone (e.g. suspected compromise), rotate it in the dashboard.
- **CSP on the frontend**: `render.yaml` already sets the real header version (with `frame-ancestors`, which a `<meta>` tag can't do) alongside the `<meta>` tag in `index.html` (kept for local dev / defense-in-depth). Both use a `*.onrender.com` wildcard for `connect-src` so they don't need editing per-deploy — tighten to your exact backend origin later if you want a stricter policy.
- **Custom domain / HTTPS**: Render terminates TLS for you automatically on `*.onrender.com` and on custom domains you attach — no action needed, but if you add a custom domain, update `FRONTEND_ORIGIN`/`VITE_API_URL` again.

## Sanity checks after deploy

```bash
curl https://aninest-backend.onrender.com/api/health
# {"ok":true}
```

Then open the frontend URL, register a real account, favorite something, and reload — if it's still there, Turso is wired up correctly. To check directly:

```bash
turso db shell aninest "SELECT username FROM users"
```

## Why Turso instead of Render's own disk/Postgres

Three real constraints ruled those out for a $0/mo personal deployment:

- **Render disks** require a paid instance type (Starter, ~$7/mo and up) — not available on the free plan at all, which is what surfaced this whole detour.
- **Render's free Postgres** expires after a fixed trial window and gets deleted — fine for a demo, not for an app meant to keep accounts around indefinitely.
- **Turso** is free with no expiry for this scale, and since it's SQLite-compatible, the backend's code didn't need a rewrite — `backend/src/lib/db.js` uses the same `@libsql/client` library and the same SQL for both local file mode (dev/tests) and remote Turso mode (production), switching automatically based on whether `TURSO_DATABASE_URL` is set.

## Scaling beyond personal use

Turso itself scales fine (it's a real managed database, not a workaround) — if you outgrow its free tier, that's a Turso plan upgrade, not an app rewrite. The one thing that *would* need code changes is dropping SQLite's dialect entirely for Postgres (different `AUTOINCREMENT`/`datetime()` syntax, etc.) — only worth doing if you specifically want Postgres for other reasons, not something scaling alone forces.
