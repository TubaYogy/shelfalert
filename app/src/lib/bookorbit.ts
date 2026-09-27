import { normalizeIsbn, normalizeTitle } from "./utils";

/**
 * Minimal typed client for a self-hosted BookOrbit instance.
 * API base: <url>/api/v1/ — Bearer (JWT) auth.
 *
 * IMPORTANT — verified against BookOrbit source (NestJS DTOs):
 *   - List endpoints paginate with `page` (0-based) and `size` (max 100),
 *     NOT `limit`. BookOrbit runs class-validator with
 *     `forbidNonWhitelisted: true`, so any unknown query param (e.g. `limit`)
 *     is rejected with HTTP 400.
 *   - List responses are shaped `{ items, total, page, size }`.
 *
 * Endpoints used:
 *   GET /api/v1/authors            (ListAuthorsDto:      page, size, sort, order)
 *   GET /api/v1/authors/:id/books  (ListAuthorBooksDto:  page, size)
 *   GET /api/v1/series             (ListSeriesDto:       page, size) — includes gaps
 *   GET /api/v1/series/:id/books   (ListSeriesBooksDto:  page, size)
 */

/** Max page size BookOrbit permits (ListAuthorsDto: @Max(100)). */
const BOOKORBIT_MAX_PAGE_SIZE = 100;

export interface BookOrbitAuthor {
  id: number;
  name: string;
  sortName?: string | null;
  imageUrl?: string | null;
  coverBookId?: number | null;
  bookCount?: number;
}

export interface BookOrbitBook {
  id: number;
  title: string | null;
  isbn13?: string | null;
  seriesId?: number | null;
  seriesName?: string | null;
  /** BookOrbit's SeriesIndex is a string ("1", "1.5"), not a number. */
  seriesIndex?: string | null;
  authors?: string[];
  publishedDate?: string | null;
  publishedYear?: number | null;
}

export interface BookOrbitSeries {
  id: number;
  name: string;
  authors?: string[];
  bookCount?: number;
  /** Total the metadata provider reports for the series, or null. */
  expectedBookCount?: number | null;
  /** Missing volume numbers, as computed by BookOrbit itself. */
  gaps?: number[];
  gapCount?: number;
}

export class BookOrbitError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BookOrbitError";
    this.status = status;
  }
}

/**
 * Obtain a fresh JWT from BookOrbit using username + password.
 * BookOrbit tokens expire after ~15 minutes, so we log in on demand before
 * each sync/API call rather than storing a static token.
 *
 * POST <url>/api/v1/auth/login  body: { username, password }
 * Response may be shaped as { token }, { accessToken }, or { data: { token } }.
 */
export async function getBookOrbitToken(
  url: string,
  username: string,
  password: string
): Promise<string> {
  if (!url || !username || !password) {
    throw new BookOrbitError("BookOrbit URL, username and password are all required.");
  }
  const base = url.replace(/\/+$/, "");
  const endpoint = `${base}/api/v1/auth/login`;

  console.log(`[BookOrbit] login → ${endpoint} (username length: ${username.length})`);

  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (err) {
    throw new BookOrbitError(
      `Could not reach BookOrbit at ${base}: ${(err as Error).message}`
    );
  }

  // Read the body once so it can be used for both error diagnostics and
  // success parsing (a Response body can only be consumed a single time).
  let bodyText = "";
  try {
    bodyText = await res.text();
  } catch {
    bodyText = "";
  }

  console.log(`[BookOrbit] login response: HTTP ${res.status}, body length: ${bodyText.length}`);

  if (res.status === 429) {
    throw new BookOrbitError(
      "BookOrbit login is rate-limited — too many recent attempts. Wait 1 minute and try again.",
      429
    );
  }

  if (res.status === 401 || res.status === 403) {
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(bodyText) as Record<string, unknown>;
    } catch {
      body = null;
    }

    if (body && body.errorCode === "ACCOUNT_LOCKED") {
      const retryAfterSeconds =
        typeof body.retryAfterSeconds === "number" ? body.retryAfterSeconds : null;
      const minutes =
        retryAfterSeconds !== null ? Math.ceil(retryAfterSeconds / 60) : null;
      const when =
        minutes !== null
          ? `Try again in ${minutes} minute(s).`
          : "Try again later.";
      throw new BookOrbitError(
        `BookOrbit account temporarily locked after too many failed attempts. ${when}`,
        res.status
      );
    }

    const snippet = bodyText.replace(/\s+/g, " ").trim().slice(0, 300);
    throw new BookOrbitError(
      `BookOrbit login rejected (HTTP ${res.status}). Check the username and password. Server replied: ${snippet}`,
      res.status
    );
  }

  if (!res.ok) {
    throw new BookOrbitError(
      `BookOrbit login returned HTTP ${res.status}. Server replied: ${bodyText.slice(0, 200)}`,
      res.status
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyText);
  } catch {
    throw new BookOrbitError("BookOrbit login returned an invalid (non-JSON) response.");
  }

  const token = extractToken(payload);
  if (!token) {
    throw new BookOrbitError(
      `BookOrbit login succeeded but no token was found in the response. Server replied: ${bodyText.slice(0, 300)}`
    );
  }
  return token;
}

/** Pull a token string out of the various shapes BookOrbit may return. */
function extractToken(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Record<string, unknown>;
  const candidates: unknown[] = [
    obj.token,
    obj.accessToken,
    obj.access_token,
    (obj.data as Record<string, unknown> | undefined)?.token,
    (obj.data as Record<string, unknown> | undefined)?.accessToken,
    (obj.data as Record<string, unknown> | undefined)?.access_token,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  return null;
}

export class BookOrbitClient {
  private baseUrl: string;
  private token: string;

  constructor(url: string, token: string) {
    this.baseUrl = url.replace(/\/+$/, "");
    this.token = token;
  }

  private async request<T>(path: string, params?: Record<string, string | number>): Promise<T> {
    const url = new URL(`${this.baseUrl}/api/v1${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, String(v));
      }
    }
    let res: Response;
    try {
      res = await fetch(url.toString(), {
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: "application/json",
        },
        // Homelab instances can be slow; give them 20s.
        signal: AbortSignal.timeout(20000),
        cache: "no-store",
      });
    } catch (err) {
      throw new BookOrbitError(
        `Could not reach BookOrbit at ${this.baseUrl}: ${(err as Error).message}`
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new BookOrbitError("BookOrbit rejected the API token (unauthorised).", res.status);
    }
    if (!res.ok) {
      throw new BookOrbitError(`BookOrbit returned HTTP ${res.status}.`, res.status);
    }
    return (await res.json()) as T;
  }

  /**
   * Test connectivity + auth. Returns the number of authors visible.
   * Uses page 0 (BookOrbit paging is 0-based) and the `size` param.
   */
  async testConnection(): Promise<{ ok: boolean; authorCount: number }> {
    const page = await this.fetchList<BookOrbitAuthor>("/authors", 0, 1);
    return { ok: true, authorCount: page.total ?? page.items.length };
  }

  /**
   * Generic paginated fetch. BookOrbit responses are shaped
   * `{ items: [...], total, page, size }`; this also tolerates a `{ data: [...] }`
   * envelope or a bare array. Paging is 0-based and uses `size` (NOT `limit`).
   */
  private async fetchList<T>(
    path: string,
    page: number,
    size: number
  ): Promise<{ items: T[]; total?: number }> {
    const raw = await this.request<unknown>(path, { page, size });
    return normalizeList<T>(raw);
  }

  /** Fetch ALL authors across all pages. */
  async getAllAuthors(pageSize = BOOKORBIT_MAX_PAGE_SIZE): Promise<BookOrbitAuthor[]> {
    return this.getAllPages<BookOrbitAuthor>("/authors", pageSize);
  }

  /** Fetch ALL series across all pages (each already carries its own gap info). */
  async getAllSeries(pageSize = BOOKORBIT_MAX_PAGE_SIZE): Promise<BookOrbitSeries[]> {
    return this.getAllPages<BookOrbitSeries>("/series", pageSize);
  }

  async getAuthorBooks(authorId: number): Promise<BookOrbitBook[]> {
    return this.getAllPages<BookOrbitBook>(`/authors/${authorId}/books`, BOOKORBIT_MAX_PAGE_SIZE);
  }

  async getSeriesBooks(seriesId: number): Promise<BookOrbitBook[]> {
    return this.getAllPages<BookOrbitBook>(`/series/${seriesId}/books`, BOOKORBIT_MAX_PAGE_SIZE);
  }

  private async getAllPages<T>(path: string, pageSize: number): Promise<T[]> {
    const size = Math.min(pageSize, BOOKORBIT_MAX_PAGE_SIZE);
    const all: T[] = [];
    // BookOrbit paging is 0-based.
    let page = 0;
    // Hard cap to avoid runaway loops on misbehaving instances.
    const MAX_PAGES = 100;
    while (page < MAX_PAGES) {
      const { items, total } = await this.fetchList<T>(path, page, size);
      all.push(...items);
      if (items.length < size) break;
      if (total !== undefined && all.length >= total) break;
      page += 1;
    }
    return all;
  }
}

/**
 * Build a fast lookup set of the titles / ISBNs a given author already has
 * in the BookOrbit library, for "in library?" checks.
 */
export function buildLibraryIndex(books: BookOrbitBook[]): {
  titles: Set<string>;
  isbns: Set<string>;
} {
  const titles = new Set<string>();
  const isbns = new Set<string>();
  for (const b of books) {
    if (b.title) titles.add(normalizeTitle(b.title));
    // BookOrbit's BookCard exposes isbn13 only (no separate isbn10).
    const i13 = normalizeIsbn(b.isbn13);
    if (i13) isbns.add(i13);
  }
  return { titles, isbns };
}

function normalizeList<T>(raw: unknown): { items: T[]; total?: number } {
  if (Array.isArray(raw)) {
    return { items: raw as T[] };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const items = (obj.data ?? obj.items ?? obj.results ?? obj.authors ?? obj.series ?? obj.books) as
      | T[]
      | undefined;
    const meta = (obj.meta ?? obj.pagination ?? obj) as Record<string, unknown>;
    const total =
      typeof meta.total === "number"
        ? meta.total
        : typeof meta.totalCount === "number"
          ? (meta.totalCount as number)
          : undefined;
    if (Array.isArray(items)) {
      return { items, total };
    }
  }
  return { items: [] };
}
