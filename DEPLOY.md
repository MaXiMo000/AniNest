# Deploying AniNest

AniNest deploys to [Render](https://render.com) as a Blueprint (`render.yaml`) with two services, plus a
[Turso](https://turso.tech) database:

| Service | Type | Plan |
|---|---|---|
| `aninest-backend` | Node web service (`backend/`) | **Starter** (always on; `render.yaml` must say `plan: starter`) |
| `aninest-frontend` | Static site (`frontend/dist`) | Free |
| Database | Turso (SQLite-compatible) | Free tier |

Pushing to `master` redeploys both services automatically.

## 1. Create the database

```bash
turso db create aninest
turso db show aninest --url        # -> TURSO_DATABASE_URL
turso db tokens create aninest     # -> TURSO_AUTH_TOKEN
```

Tables are created automatically when the backend boots. There's no migration step.

## 2. Create the Blueprint

In the Render dashboard choose **New -> Blueprint** and select this repository. Render reads `render.yaml` and asks for the
`sync: false` values:

| Variable | Service | Required | Value |
|---|---|---|---|
| `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | backend | yes | from step 1 |
| `ADMIN_USERNAMES` | backend | no | comma-separated usernames to make admins (see step 4) |
| `YOUTUBE_API_KEY` | backend | no | enables the admin page's channel import and search (see step 5) |
| `TURNSTILE_SECRET_KEY` | backend | no | Cloudflare Turnstile secret, for a bot check on registration |
| `VITE_TURNSTILE_SITE_KEY` | frontend | no | the matching Turnstile site key |

Leave any optional value blank to switch that feature off.

## 3. Point the services at each other

`render.yaml` assumes the URLs `https://aninest-frontend.onrender.com` and `https://aninest-backend.onrender.com`. If Render gives
your services different URLs:

- **Backend -> Environment**: set `FRONTEND_ORIGIN` to the frontend's URL. It's the only origin CORS allows.
- **Frontend -> Environment**: set `VITE_API_URL` to the backend's URL, then **redeploy the frontend**. A static site's variables
  are baked in at build time.
- In `render.yaml`, replace `https://aninest-backend.onrender.com` in the frontend's `Content-Security-Policy` header (`img-src`,
  used by the manga cover proxy) with your backend's URL. Do the same in the `<meta>` CSP in `frontend/index.html`. Browsers
  enforce both policies, so they have to agree.

## 4. Make yourself an admin

The admin role is applied at every boot from `ADMIN_USERNAMES`, and only to accounts that already exist:

1. Register your account on the live site.
2. Set `ADMIN_USERNAMES` on the backend to your username. Changing a variable restarts the service.
3. Log in again. **Watch-Source Curation** now appears in the **More** menu (`#/admin/watch-sources`).

## 5. YouTube Data API key (optional)

In Google Cloud Console, create a project, enable **YouTube Data API v3**, and create an **API key**. No billing is needed. The
free quota is 10,000 units a day. Importing a channel costs about 1 unit per 50 videos, and a search costs 100. When the quota runs
out the admin page says so. Pasting links by hand and user submissions keep working without the key.

## Checking a deploy

```bash
curl https://aninest-backend.onrender.com/api/health
# {"ok":true}
```

Then on the live site:
- Register or log in, favorite an anime and reload the page. If it's still there, the database is connected.
- Open **Manga**. If the covers load, the cover proxy and the CSP `img-src` are right.
- Open an anime that has free episodes and play one. If it plays, the `frame-src` CSP and the Referrer-Policy are right.

To look at the database directly: `turso db shell aninest "SELECT username, is_admin FROM users"`.

## Pitfalls

- **Blueprint sync fails with a plan change**: the `plan:` in `render.yaml` has to match the plan chosen in the dashboard. If you
  change the plan in the dashboard, change the file as well.
- **Everyone looks logged out in production**: the frontend and backend are on different sites, so the cookies must be
  `SameSite=None; Secure`. The backend sets that automatically when `NODE_ENV=production`, so don't change `NODE_ENV`.
- **Images or embeds blocked**: a new image, media or frame origin has to be added to both CSPs (`render.yaml` and `index.html`).
- **Changed `VITE_API_URL` but nothing happened**: the frontend needs a rebuild (a manual deploy).
- **Logging everyone out**: delete the rows in the `sessions` table. Sessions don't depend on any secret.

## Why Turso

Turso is SQLite-compatible, so the same `@libsql/client` code runs against a local file in development and tests and against Turso
in production (`backend/src/lib/db.js` picks based on whether `TURSO_DATABASE_URL` is set). Turso's free tier doesn't expire and
needs no disk on the web service. Outgrowing it means a Turso plan upgrade, not a code change. Moving to Postgres would mean porting
SQLite-specific SQL (`datetime('now')`, `ON CONFLICT` upserts, `AUTOINCREMENT`).
