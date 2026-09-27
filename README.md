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
- **Upcoming + recent releases** — configurable window (default: 2 months back, 3 months ahead), refreshed on a schedule.
- **Missing-book detection** — cross-references each release against your BookOrbit library (ISBN + title match) and flags what you don't own.
- **Missing-in-series** — reads BookOrbit series data and highlights gaps (e.g. you have #1, #2, #4 → #3 is missing).
- **Timeline dashboard** — month-grouped, color-coded status badges (🔵 Upcoming / 🟢 In Library / 🟠 Missing), cover art, per-author filter, dark/light theme.
- **Homarr V2 widget** — token-guarded JSON endpoint **and** an embeddable iFrame widget page.
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

> **Dev mode:** `docker-compose.override.yml` is applied automatically by
> `docker compose up` and runs the app with hot-reload against the `builder` stage.
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
`docker-compose.build.yml` variant (identical to the production stack but adds a
`build:` directive):

```bash
docker compose -f docker-compose.build.yml up -d --build
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

1. **Author sync** (`/api/sync/bookorbit`): pages through BookOrbit `/api/v1/authors`, upserts each author, and scans `/api/v1/series` for gaps.
2. **Release sync** (`/api/sync/releases`): for every active author →
   - Query Google Books `inauthor:"Name"&orderBy=newest` (falls back to Open Library if few results).
   - Keep releases whose date is within `[today - lookbackDays, today + lookaheadDays]`.
   - Deduplicate by ISBN, then normalized title.
   - Cross-reference the author's BookOrbit books to set `inLibrary`.
   - Status = **UPCOMING** (future) / **RECENT** (past & owned) / **MISSING** (past & not owned).
   - A polite 500 ms delay between authors keeps the external APIs happy.
3. **Scheduler** (`server.ts` + `lib/scheduler.ts`): hourly tick recomputes statuses and triggers a full sync once `syncIntervalHours` has elapsed. Runs immediately on boot if overdue.

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
├── docker-compose.yml            # production stack (app + postgres)
├── docker-compose.override.yml   # dev hot-reload overrides
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
