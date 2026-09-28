# 📚 ShelfAlert

**Self-hosted upcoming book-release tracker for your homelab.**

ShelfAlert watches the authors in your [BookOrbit](https://github.com/bookorbit/bookorbit)
library and tells you when they have new books coming out — cross-referencing the
free **Google Books** and **Open Library** APIs, then flagging which releases you're
**missing** from your library. It ships with a polished dashboard, a Homarr V2 widget,
and a background sync scheduler, all in a single `docker compose` stack.

> This is how sites like *BookNotification.com*, *FantasticFiction.com* and
> *NewBooksAlert.com* work under the hood: they keep a list of authors, poll book
> metadata catalogues (Google Books / Open Library / ISBNdb), and diff new ISBNs
> against what already exists. ShelfAlert does the same, but privately, for **your**
> library.

---

## ✨ Features

- **Author tracking** — pulls your author list straight from BookOrbit (`/api/v1/authors`), or add authors manually.
- **Multi-source release data** — aggregates from **Google Books**, **Open Library**, **Hardcover.app** (optional), and **BookNotification.com** (optional scraper).
- **Upcoming + recent releases** — configurable window (default: 6 months back, 3 months ahead), refreshed on a schedule.
- **Missing-book detection** — cross-references each release against your BookOrbit library (ISBN + title match) and flags what you don't own.
- **Series gap detection** — reads BookOrbit series data, highlights missing books in series (e.g. you have #1, #2, #4 → #3 flagged), and fetches expected titles from Hardcover.
- **BookNotification.com integration** — optionally scrape your personal BookNotification calendar to supplement release data, with a dashboard section highlighting authors you haven't yet added to your BN watchlist.
- **Timeline dashboard** — month-grouped, color-coded status badges (🔵 Upcoming / 🟢 In Library / 🟠 Missing), cover art, series info, per-author filter, dark/light theme.
- **Homarr V2 widget** — token-guarded JSON endpoint **and** an embeddable iFrame widget page.
- **Fire-and-forget sync** — long-running syncs return `202 Accepted` immediately; poll `/api/sync/status` for completion.
- **Scheduled background sync** — `node-cron` inside a custom Next.js server; runs on boot if overdue.
- **Simple auth now, SSO later** — username/password to start, OIDC (Authelia/Authentik) ready via env vars.
- **Dockhand / Portainer / Watchtower friendly** — health checks, named volumes, update labels.

---

## 🧱 Tech stack

| Layer      | Choice                                             |
|------------|----------------------------------------------------|
| Framework  | Next.js 15 (App Router, TypeScript) + custom server |
| Database   | PostgreSQL 17 + Prisma ORM                         |
| Auth       | Signed JWT session cookie (bcrypt), OIDC-ready     |
| Scheduler  | node-cron (in-process)                             |
| UI         | Tailwind CSS + Lucide icons                        |
| APIs       | Google Books + Open Library (free, no key needed)  |

---

## 🚀 Quick start

```bash
# 1. Clone / copy this folder onto your homelab host
cd shelfalert

# 2. Create your environment file
cp .env.example .env

# 3. Edit .env — set at minimum:
#    POSTGRES_PASSWORD, NEXTAUTH_SECRET, ADMIN_PASSWORD, NEXTAUTH_URL
#    Generate a secret with:  openssl rand -hex 32

# 4. Start the stack
docker compose up -d

# 5. Open the app
#    http://<host>:3001   (log in with ADMIN_USERNAME / ADMIN_PASSWORD)
```

On first boot ShelfAlert creates the admin user and default settings automatically,
applies the database schema (`prisma db push`), and starts the sync scheduler.

> **Dev mode:** local development uses `dev/docker-compose.dev.yml`, which runs the
> app with hot-reload against the `builder` stage. It is **not** auto-merged by
> Docker Compose (so it never interferes with Dockhand/Portainer deployments that
> only clone the repo). Start it explicitly with:
> `docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up`.
> For a **production-only** run use: `docker compose -f docker-compose.yml up -d`.

---

## 🔑 BookOrbit setup (getting your API token)

ShelfAlert talks to BookOrbit's REST API (`/api/v1/`) using a **Bearer (JWT) token**.

**Option A — copy it from your browser (fastest):**
1. Log in to your BookOrbit web UI.
2. Open DevTools → **Network** tab, and click any request to `/api/v1/...`.
3. Under **Request Headers**, copy the value after `Authorization: Bearer ` (the long token).

**Option B — request one via the login endpoint:**
```bash
curl -X POST http://<bookorbit-host>:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"yourpassword"}'
# → copy the "token" / "accessToken" field from the JSON response
```

Then in ShelfAlert go to **Settings → BookOrbit Connection**:
- **BookOrbit URL**: e.g. `http://192.168.1.50:3000`
- **API Token**: paste the token
- Click **Test Connection** → it should report the number of authors visible.
- **Save Settings**, then hit **Sync from BookOrbit** on the Authors page.

The token is stored **AES-256-GCM encrypted** in the database (key derived from `NEXTAUTH_SECRET`).

---

## 📖 Optional data sources

### Hardcover.app (recommended)

[Hardcover](https://hardcover.app) is a free book-tracking community with excellent metadata
coverage for upcoming releases. Adding your Hardcover API key **dramatically improves**
upcoming-book discovery, especially for null-dated pre-announcements that Google Books misses.

**Setup:**
1. Create a free Hardcover account at [hardcover.app](https://hardcover.app)
2. Go to **Settings → API** and generate a personal API token (1-year validity)
3. In ShelfAlert **Settings → Data Sources → Hardcover**, paste the token
4. Click **Test Connection** → should show your Hardcover username
5. Save and run a sync

**Rate limits:** 60 req/min, 5000 req/day. ShelfAlert respects these with automatic
backoff and 2-second inter-call delays.

**What it adds:**
- Upcoming books with null or future `release_date` that Google Books doesn't index yet
- Series metadata (name + number) for gap detection
- Expected book titles for missing series positions

### BookNotification.com scraper (optional)

If you already track authors on [BookNotification.com](https://www.booknotification.com),
ShelfAlert can **scrape your personal book calendar** to supplement release data. This is
especially useful if you've hit FantasticFiction's 200-author limit.

**Setup:**
1. Have an active BookNotification.com account with authors in your watchlist
2. In ShelfAlert **Settings → Data Sources → BookNotification**, enter your login email/username and password
3. Click **Sync BookNotification** — it logs in, scrapes `/my-library/book-calendar/`, and imports releases
4. Releases are matched to your tracked authors by name

**"Add to BookNotification" workflow:**
- After syncing, ShelfAlert flags authors from your BookOrbit library that aren't yet tracked on BookNotification
- The dashboard shows a collapsible **"Add to BookNotification"** section listing these "untracked" authors
- Manually add them to your BookNotification watchlist, then re-sync to clear the list

**Credentials security:** Stored AES-256-GCM encrypted. The scraper mimics a real browser
to avoid bot detection.

---

## 🧩 Homarr V2 widget

ShelfAlert exposes a **token-guarded JSON endpoint** and a ready-made **iFrame page**.
Grab both URLs (with your widget token pre-filled) from **Settings → Homarr Widget**.

### A) JSON endpoint (custom "API/Fetch" widget)

```
GET http://<host>:3001/api/widget/upcoming?token=<WIDGET_TOKEN>&limit=5
```

Response shape:
```json
{
  "upcoming": [
    {
      "title": "Book Title",
      "author": "Author Name",
      "publishDate": "2026-10-15",
      "coverUrl": "https://www.russh.com/wp-content/uploads/2025/09/empyrean-series-book-four.jpg...",
      "status": "UPCOMING",
      "daysUntil": 18,
      "seriesName": "Series Name",
      "seriesNumber": 4
    }
  ],
  "missing": 3,
  "total": 24,
  "lastSync": "2026-09-27T10:00:00Z"
}
```

**Sample Homarr V2 custom widget JSX** (Mantine components), pointing at the endpoint above:

```jsx
// Homarr V2 → Add Widget → Custom → fetch JSON from the URL, render with:
export default function ShelfAlert({ data }) {
  const items = data?.upcoming ?? [];
  return (
    <Stack gap="xs" p="xs">
      <Group justify="space-between">
        <Text fw={700} size="sm">📚 Upcoming Releases</Text>
        <Badge color="orange" variant="light">{data?.missing ?? 0} missing</Badge>
      </Group>
      {items.length === 0 && <Text size="xs" c="dimmed">No upcoming releases</Text>}
      {items.map((b, i) => (
        <Group key={i} wrap="nowrap" gap="sm">
          {b.coverUrl && <Image src={b.coverUrl} w={32} h={46} radius="sm" />}
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text size="sm" fw={600} truncate>{b.title}</Text>
            <Text size="xs" c="dimmed" truncate>{b.author}</Text>
            <Text size="xs" c="blue">in {b.daysUntil}d · {b.publishDate}</Text>
          </Stack>
        </Group>
      ))}
    </Stack>
  );
}
```

### B) iFrame widget (zero-config)

Add an **iFrame widget** in Homarr pointing at:
```
http://<host>:3001/widget?token=<WIDGET_TOKEN>&theme=dark&limit=5
```
- `theme` = `dark` | `light`
- `limit` = number of books (1–25)
- Auto-refreshes every 30 minutes.

> Regenerate the widget token any time from **Settings** (existing widgets will need the new URL).

---

## 🔐 OIDC setup (Authelia / Authentik) — optional

ShelfAlert starts with simple credential login. To wire up SSO later, set these three
environment variables and restart the stack:

```env
OIDC_CLIENT_ID=shelfalert
OIDC_CLIENT_SECRET=your_generated_secret
OIDC_ISSUER=https://auth.yourdomain.com   # your Authelia/Authentik issuer URL
```

When all three are present, Settings shows **OIDC: Enabled**. In your IdP, register a
confidential client with redirect URI `https://<your-shelfalert-url>/api/auth/callback/oidc`
and the `openid profile email` scopes. (Credential login remains available as a fallback.)

---

## 🐳 Deploying as a Dockhand / Portainer stack

### The image is auto-built for you (no build step at deploy time)

A GitHub Actions workflow (`.github/workflows/docker-publish.yml`) **automatically
builds the Docker image on every push to `main`** (and on manual dispatch) and pushes
it to the GitHub Container Registry:

```
ghcr.io/tubayogy/shelfalert:latest
ghcr.io/tubayogy/shelfalert:sha-<short-sha>   # immutable, per-commit
```

This is what makes ShelfAlert deployable from Git-based stack managers like **Dockhand**,
**Portainer** and **Dockge** — those tools pull the compose file from GitHub but **cannot
build images from source at deploy time**, so `docker-compose.yml` references the
pre-built GHCR image (it has **no `build:` directive**).

> The GHCR image is **public**, so **no registry authentication is required** in Dockhand
> to pull it.

### Deploy in Dockhand (recommended)

1. **Stacks → Add a new stack → Git repository.**
2. **Repository URL:** `https://github.com/TubaYogy/shelfalert`
3. **Compose file path:** `docker-compose.yml`
4. **Set the environment variables** in the Dockhand stack UI:

   | Variable            | Required | Notes                                         |
   |---------------------|----------|-----------------------------------------------|
   | `POSTGRES_PASSWORD` | ✅       | Password for the bundled Postgres             |
   | `NEXTAUTH_SECRET`   | ✅       | `openssl rand -hex 32`                         |
   | `NEXTAUTH_URL`      | ✅       | Public URL, e.g. `http://<host>:3001`         |
   | `ADMIN_PASSWORD`    | ✅       | Initial admin password                        |
   | `ADMIN_USERNAME`    | ❌       | Optional — defaults to `admin`                |
   | `PORT`              | ❌       | Optional — host port, defaults to `3001`      |

5. **Deploy the stack.** Dockhand pulls `ghcr.io/tubayogy/shelfalert:latest`, starts
   Postgres, applies the schema on boot, and launches ShelfAlert.

### Deploy in Portainer

*Stacks → Add stack → Repository* → point at
`https://github.com/TubaYogy/shelfalert`, compose path `docker-compose.yml`, add the same
environment variables under **Environment variables**, then **Deploy the stack**. (Or use
the Web editor and paste `docker-compose.yml`.)

Published port defaults to **3001** (`PORT` env). The app container listens on `3000`
internally with a `/login` health check; the DB uses `pg_isready`. Services carry
`dockhand.stack=shelfalert` labels for grouping.

### Building from source instead (local development)

If you'd rather build the image locally instead of pulling from GHCR, use the
`dev/docker-compose.build.yml` variant (identical to the production stack but adds a
`build:` directive):

```bash
docker compose -f dev/docker-compose.build.yml up -d --build
```

### Updating (Watchtower compatible)

Both services carry `com.centurylinklabs.watchtower.enable=true`. Because the image is
published to GHCR on every push to `main`, Watchtower will pull the rebuilt image
automatically. Manual update:

```bash
docker compose pull        # pulls the latest GHCR image
docker compose up -d
```

Schema changes are applied automatically on container start via `prisma db push`.

---

## ⚙️ Environment variables

| Variable            | Required | Default                  | Purpose                                   |
|---------------------|----------|--------------------------|-------------------------------------------|
| `POSTGRES_PASSWORD` | ✅       | `shelfalert`             | Postgres password                         |
| `NEXTAUTH_SECRET`   | ✅       | —                        | Signs sessions + encrypts BookOrbit token |
| `NEXTAUTH_URL`      | ✅       | `http://localhost:3001`  | Public URL (used in widget links)         |
| `ADMIN_USERNAME`    | ✅       | `admin`                  | Initial admin username                    |
| `ADMIN_PASSWORD`    | ✅       | —                        | Initial admin password                    |
| `PORT`              | ❌       | `3001`                   | Host port to publish                      |
| `OIDC_CLIENT_ID`    | ❌       | —                        | OIDC SSO client id                        |
| `OIDC_CLIENT_SECRET`| ❌       | —                        | OIDC SSO client secret                    |
| `OIDC_ISSUER`       | ❌       | —                        | OIDC issuer URL                           |
| `GOOGLE_BOOKS_API_KEY` | ❌    | —                        | Optional, only if you hit rate limits     |

---

## 🗃️ How the sync works

ShelfAlert uses a **fire-and-forget** sync model: manual sync buttons return `202 Accepted`
immediately and the work runs in the background. Poll `/api/sync/status` or watch the
dashboard spinner to track completion.

### 1. Author sync (`POST /api/sync/bookorbit`)
- Pages through BookOrbit `/api/v1/authors`, upserts each author
- Scans `/api/v1/series` to build a series→books index for gap detection
- Identifies missing positions (e.g. you own #1, #2, #4 → flags #3 as a gap)
- If Hardcover is configured, looks up expected titles for missing positions via the `book_series` query
- Returns immediately with 202; actual work runs async

### 2. Release sync (`POST /api/sync/releases`)
For every **active** author, gather releases from multiple sources:
1. **Google Books** — `inauthor:"Name"&orderBy=newest` (pages 1+2, max 80 books)
2. **Open Library** — fallback when Google Books returns <20 results
3. **Hardcover** (optional) — targeted query for upcoming + null-dated books (respects 60 req/min with 2s delays and 429 retry-with-backoff)
4. **Dedupe strategy** — merge by ISBN/title, preferring records with **future publish dates** over past/null dates (fixes Google Books stale-date issue)
5. **Filter by window** — keep only releases within `[today - lookbackDays, today + lookaheadDays]` (defaults: 180 back, 90 ahead)
6. **Match to library** — cross-reference BookOrbit books by ISBN + normalized title to set `inLibrary`
7. **Compute status**:
   - **UPCOMING** = future date
   - **RECENT** = past date + in library
   - **MISSING** = past date + not in library
8. Upsert all releases to the database

Returns 202 immediately; the sync continues in the background.

### 3. BookNotification sync (`POST /api/sync/booknotification`)
- Logs into booknotification.com via WordPress form POST
- Scrapes the `/my-library/book-calendar/` HTML page
- Parses release table (title, author, series, date)
- Matches releases to existing tracked authors by normalized name
- Upserts as UPCOMING/RECENT and marks matched authors as `bookNotificationTracked = true`
- Dashboard highlights any authors **not** seen on BN (the "add to BN" workflow)

### 4. Background scheduler
- **Hourly tick** (`node-cron` in `server.ts`): recomputes release statuses and checks if a full sync is due
- **On boot**: runs an immediate full sync if `lastReleaseSync` is older than `syncIntervalHours`
- **Manual trigger**: dashboard "Full Sync" button calls `/api/sync/releases?full=1`

---

## 🛠️ Troubleshooting

| Symptom | Fix |
|---------|-----|
| **"Could not reach BookOrbit"** | Check the URL/port from *inside the container's network*. Use the LAN IP, not `localhost`. Confirm the token with **Test Connection**. |
| **"BookOrbit rejected the API token"** | Token expired — grab a fresh one (see BookOrbit setup). |
| **No releases appear** | Add/enable authors first, then run a **Full Sync**. Widen the lookback/lookahead window in Settings. |
| **Covers not loading** | Some Open Library entries lack cover art; a placeholder is shown. |
| **Widget shows "Invalid token"** | Copy the exact URL from Settings, or regenerate the token. |
| **DB connection errors on first boot** | The entrypoint retries `prisma db push` 5×; ensure the `db` service is healthy (`docker compose ps`). |
| **Forgot admin password** | Delete the `User` row and restart — a fresh admin is created from `ADMIN_*` env vars. |

---

## 📁 Project layout

```
shelfalert/
├── docker-compose.yml            # production stack (app + postgres) — the only compose Dockhand sees
├── dev/
│   ├── docker-compose.dev.yml    # dev hot-reload overrides (run explicitly, not auto-merged)
│   └── docker-compose.build.yml  # build-from-source variant for local dev
├── .env.example
└── app/
    ├── Dockerfile                # multi-stage build
    ├── docker-entrypoint.sh      # db push + start server
    ├── server.ts                 # custom Next.js server + cron
    ├── prisma/schema.prisma
    └── src/
        ├── app/                  # pages + API routes
        ├── components/           # UI, dashboard, authors, widget
        ├── lib/                  # bookorbit, google-books, open-library,
        │                         # release-sync, scheduler, auth, crypto...
        └── middleware.ts         # route protection
```

---

## 📜 License

MIT — personal, self-hosted use. Book metadata © their respective providers
(Google Books, Open Library). ShelfAlert is not affiliated with BookOrbit.
