import { NormalizedRelease } from "./google-books";
import { parseFlexibleDate } from "./utils";

/**
 * Hardcover.app data source (GraphQL).
 * Docs: https://docs.hardcover.app/api/getting-started/
 *
 * Auth: `Authorization: Bearer <token>` (1-year personal tokens).
 * Rate limit: 60 requests/minute — the CALLER is responsible for spacing calls
 * (sleep ~1100ms between authors); this module never sleeps.
 */

const HARDCOVER_ENDPOINT = "https://api.hardcover.app/v1/graphql";

const SEARCH_AUTHOR_QUERY = `
  query SearchAuthor($name: String!) {
    search(query: $name, query_type: "Author", per_page: 5) {
      results
    }
  }
`;

const AUTHOR_BOOKS_QUERY = `
  query AuthorBooks($authorId: Int!, $limit: Int!) {
    books(
      where: { contributions: { author_id: { _eq: $authorId } } }
      order_by: { release_date: desc_nulls_last }
      limit: $limit
    ) {
      id
      slug
      title
      release_date
      series_books {
        series {
          name
        }
        position
      }
      contributions {
        author {
          id
          name
        }
      }
      editions {
        isbn_13
        reading_format_id
      }
    }
  }
`;

interface HardcoverBook {
  id: number;
  slug?: string;
  title?: string;
  release_date?: string | null;
  series_books?: {
    series?: { name?: string | null } | null;
    position?: number | string | null;
  }[];
  contributions?: { author?: { id?: number; name?: string } | null }[];
  editions?: { isbn_13?: string | null; reading_format_id?: number | null }[];
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/**
 * Low-level GraphQL POST helper with a 30s timeout and consistent error handling.
 */
async function hardcoverGraphQL<T>(
  query: string,
  variables: Record<string, unknown>,
  apiKey: string
): Promise<T> {
  const token = apiKey.trim();
  const authHeader = token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(HARDCOVER_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(30000),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Hardcover request failed: ${(err as Error).message}`);
  }

  if (!res.ok) {
    throw new Error(`Hardcover returned HTTP ${res.status}`);
  }

  let body: GraphQLResponse<T>;
  try {
    body = (await res.json()) as GraphQLResponse<T>;
  } catch {
    throw new Error("Hardcover returned malformed JSON");
  }

  if (body.errors && body.errors.length > 0) {
    throw new Error(`Hardcover GraphQL error: ${body.errors.map((e) => e.message).join("; ")}`);
  }
  if (!body.data) {
    throw new Error("Hardcover response contained no data");
  }
  return body.data;
}

interface SearchAuthorData {
  search?: {
    // The Hardcover `search` field returns a JSON blob under `results`.
    results?: {
      hits?: { document?: { id?: number | string; name?: string } }[];
    };
  };
}

/** Resolve an author name to a Hardcover author id (best fuzzy match). */
async function resolveAuthorId(authorName: string, apiKey: string): Promise<number | null> {
  const data = await hardcoverGraphQL<SearchAuthorData>(
    SEARCH_AUTHOR_QUERY,
    { name: authorName },
    apiKey
  );

  const hits = data.search?.results?.hits ?? [];
  const target = authorName.trim().toLowerCase();

  let fallback: number | null = null;
  for (const hit of hits) {
    const doc = hit.document;
    if (!doc?.id) continue;
    const id = Number(doc.id);
    if (!Number.isFinite(id)) continue;
    if (fallback === null) fallback = id;

    const name = (doc.name ?? "").trim().toLowerCase();
    if (name && (name === target || name.includes(target) || target.includes(name))) {
      return id;
    }
  }
  // No close textual match — return the top hit only if it exists.
  return fallback;
}

interface AuthorBooksData {
  books?: HardcoverBook[];
}

function normalizeBook(book: HardcoverBook): NormalizedRelease | null {
  if (!book.title) return null;

  const isbn13 = book.editions?.find((e) => e.isbn_13)?.isbn_13 ?? undefined;

  const firstSeries = book.series_books?.[0];
  const seriesName = firstSeries?.series?.name ?? undefined;
  let seriesNumber: number | undefined;
  if (firstSeries?.position != null) {
    const n = Number(firstSeries.position);
    if (Number.isFinite(n)) seriesNumber = n;
  }

  const authorNames = (book.contributions ?? [])
    .map((c) => c.author?.name)
    .filter((n): n is string => Boolean(n));

  return {
    title: book.title,
    isbn13: isbn13 ?? undefined,
    publishDate: book.release_date ? parseFlexibleDate(book.release_date) : null,
    publishDateRaw: book.release_date ?? undefined,
    seriesName: seriesName || undefined,
    seriesNumber,
    hardcoverId: String(book.id),
    dataSource: "hardcover",
    authorNames,
  };
}

/**
 * Search Hardcover for an author's books.
 *
 * @param authorName      Display name to resolve when no cached id is available.
 * @param apiKey          Hardcover API token.
 * @param cachedAuthorId  Previously-resolved Hardcover author id (skips the search step).
 * @returns The normalized releases plus the resolved Hardcover author id (null if unresolved).
 */
export async function searchHardcoverByAuthor(
  authorName: string,
  apiKey: string,
  cachedAuthorId?: number | null
): Promise<{ releases: NormalizedRelease[]; resolvedAuthorId: number | null }> {
  let authorId = cachedAuthorId ?? null;

  if (!authorId) {
    authorId = await resolveAuthorId(authorName, apiKey);
  }
  if (!authorId) {
    return { releases: [], resolvedAuthorId: null };
  }

  const data = await hardcoverGraphQL<AuthorBooksData>(
    AUTHOR_BOOKS_QUERY,
    { authorId, limit: 150 },
    apiKey
  );

  const books = data.books ?? [];
  const releases = books
    .map((b) => normalizeBook(b))
    .filter((r): r is NormalizedRelease => r !== null);

  return { releases, resolvedAuthorId: authorId };
}

/* ------------------------------------------------------------------ */
/*  Series book title lookup                                           */
/* ------------------------------------------------------------------ */

const SERIES_BOOKS_QUERY = `
  query SeriesBooks($name: String!) {
    series(where: { name: { _ilike: $name } }, limit: 5) {
      id
      name
      book_series(order_by: { position: asc }) {
        position
        book {
          title
        }
      }
    }
  }
`;

interface SeriesBooksData {
  series?: {
    id: number;
    name?: string | null;
    book_series?: {
      position?: number | string | null;
      book?: { title?: string | null } | null;
    }[];
  }[];
}

/**
 * Fetch book titles for specific missing positions in a named series.
 * Returns a Map<position, title> for every position that Hardcover knows about.
 * Best-effort — returns an empty Map on any error.
 */
export async function lookupSeriesBookTitles(
  seriesName: string,
  apiKey: string
): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  try {
    const data = await hardcoverGraphQL<SeriesBooksData>(
      SERIES_BOOKS_QUERY,
      { name: seriesName },
      apiKey
    );

    const results = data.series ?? [];
    if (results.length === 0) return map;

    // Pick the closest name match.
    const target = seriesName.trim().toLowerCase();
    let best = results[0];
    for (const s of results) {
      if ((s.name ?? "").toLowerCase() === target) {
        best = s;
        break;
      }
    }

    for (const sb of best.book_series ?? []) {
      const pos = Number(sb.position);
      const title = sb.book?.title ?? null;
      if (Number.isFinite(pos) && pos > 0 && title) {
        map.set(pos, title);
      }
    }
  } catch {
    /* best-effort — swallow errors */
  }
  return map;
}

/** Verify an API token by querying the current user. Returns the username. */
export async function testHardcoverToken(apiKey: string): Promise<string> {
  const data = await hardcoverGraphQL<{ me?: { id?: number; username?: string } | { id?: number; username?: string }[] }>(
    `query { me { id username } }`,
    {},
    apiKey
  );
  const me = Array.isArray(data.me) ? data.me[0] : data.me;
  if (!me?.username) {
    throw new Error("Token accepted but no user returned");
  }
  return me.username;
}
