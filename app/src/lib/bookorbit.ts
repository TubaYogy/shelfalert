import { normalizeIsbn, normalizeTitle } from "./utils";

/**
 * Minimal typed client for a self-hosted BookOrbit instance.
 * API base: <url>/api/v1/ — Bearer (JWT) auth.
 *
 * Endpoints used:
 *   GET /api/v1/authors            (paginated)
 *   GET /api/v1/authors/:id/books
 *   GET /api/v1/series             (paginated)
 *   GET /api/v1/series/:id/books
 */

export interface BookOrbitAuthor {
  id: number;
  name: string;
  sortName?: string | null;
  photoUrl?: string | null;
  bookCount?: number;
}

export interface BookOrbitBook {
  id: number;
  title: string;
  isbn?: string | null;
  isbn13?: string | null;
  seriesName?: string | null;
  seriesNumber?: number | null;
  authorId?: number | null;
}

export interface BookOrbitSeries {
  id: number;
  name: string;
  authorName?: string | null;
  bookCount?: number;
}

export class BookOrbitError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "BookOrbitError";
    this.status = status;
  }
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
   */
  async testConnection(): Promise<{ ok: boolean; authorCount: number }> {
    const page = await this.fetchList<BookOrbitAuthor>("/authors", 1, 1);
    return { ok: true, authorCount: page.total ?? page.items.length };
  }

  /**
   * Generic paginated fetch. BookOrbit responses may be shaped as
   * { data: [...], meta: { total, page, limit } } OR { items, total } OR a bare array.
   * This normalises all three.
   */
  private async fetchList<T>(
    path: string,
    page: number,
    limit: number
  ): Promise<{ items: T[]; total?: number }> {
    const raw = await this.request<unknown>(path, { page, limit });
    return normalizeList<T>(raw);
  }

  /** Fetch ALL authors across all pages. */
  async getAllAuthors(pageSize = 200): Promise<BookOrbitAuthor[]> {
    return this.getAllPages<BookOrbitAuthor>("/authors", pageSize);
  }

  /** Fetch ALL series across all pages. */
  async getAllSeries(pageSize = 200): Promise<BookOrbitSeries[]> {
    return this.getAllPages<BookOrbitSeries>("/series", pageSize);
  }

  async getAuthorBooks(authorId: number): Promise<BookOrbitBook[]> {
    const raw = await this.request<unknown>(`/authors/${authorId}/books`, { limit: 500 });
    return normalizeList<BookOrbitBook>(raw).items;
  }

  async getSeriesBooks(seriesId: number): Promise<BookOrbitBook[]> {
    const raw = await this.request<unknown>(`/series/${seriesId}/books`, { limit: 500 });
    return normalizeList<BookOrbitBook>(raw).items;
  }

  private async getAllPages<T>(path: string, pageSize: number): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    // Hard cap to avoid runaway loops on misbehaving instances.
    const MAX_PAGES = 100;
    while (page <= MAX_PAGES) {
      const { items, total } = await this.fetchList<T>(path, page, pageSize);
      all.push(...items);
      if (items.length < pageSize) break;
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
    const i10 = normalizeIsbn(b.isbn);
    const i13 = normalizeIsbn(b.isbn13);
    if (i10) isbns.add(i10);
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
