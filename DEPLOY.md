# Deploying AniNest to Render

`render.yaml` at the repo root defines both services as a Blueprint, so the easiest path is:

1. Push this repo to GitHub.
2. In the Render dashboard: **New → Blueprint**, point it at the repo. Render reads `render.yaml` and creates both services.
3. **First deploy will fail to talk cross-service** — that's expected. Render assigns each service's `*.onrender.com` URL only after it exists, so `FRONTEND_ORIGIN` (on the backend) and `VITE_API_URL` (on the frontend) are placeholders in `render.yaml` until you fill in the real ones:
   - Open **aninest-backend → Environment**, set `FRONTEND_ORIGIN` to the actual frontend URL Render assigned.
   - Open **aninest-frontend → Environment**, set `VITE_API_URL` to the actual backend URL Render assigned, then trigger a manual redeploy of the frontend (env vars are baked in at build time for a static site, so changing one requires a rebuild).
4. Confirm `aninest-backend`'s disk is attached (Render creates it from the `disk:` block automatically) — this is what makes your SQLite data (accounts, favorites, sessions) survive redeploys. **Without it, every deploy wipes the database.**

## Things that don't come from the Blueprint automatically

- **`SESSION_SECRET`**: `generateValue: true` makes Render create a random one on first deploy — good, don't overwrite it with the value from your local `.env`. If you ever need to force-logout everyone (e.g. suspected compromise), rotate it in the dashboard.
- **CSP on the frontend**: `render.yaml` already sets the real header version (with `frame-ancestors`, which a `<meta>` tag can't do) alongside the `<meta>` tag in `index.html` (kept for local dev / defense-in-depth). Both use a `*.onrender.com` wildcard for `connect-src` so they don't need editing per-deploy — tighten to your exact backend origin later if you want a stricter policy.
- **Custom domain / HTTPS**: Render terminates TLS for you automatically on `*.onrender.com` and on custom domains you attach — no action needed, but if you add a custom domain, update `FRONTEND_ORIGIN`/`VITE_API_URL` again.

## Sanity checks after deploy

```bash
curl https://aninest-backend.onrender.com/api/health
# {"ok":true}
```

Then open the frontend URL, register a real account, favorite something, and reload — if it's still there, the disk is mounted correctly.

## Scaling beyond one instance

The current setup (SQLite + a persistent disk) works for a single backend instance, which is what Render's free/starter web service plans give you. If you ever move to a plan that autoscales to multiple instances, SQLite-on-disk stops working (each instance would have its own disk) — at that point, migrate to Render's managed Postgres instead. That's a real migration (swapping `node:sqlite` calls for a Postgres client), not a config change — ask for it explicitly when you're ready to scale, no need to do it preemptively for personal use.
