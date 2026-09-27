import { NormalizedRelease } from "./google-books";
import { parseFlexibleDate } from "./utils";

/**
 * Open Library search client (free, no key).
 * https://openlibrary.org/search.json?author=Name&sort=new&limit=20
 */

interface OpenLibraryDoc {
  key?: string; // "/works/OL123W"
  title?: string;
  author_name?: string[];
  first_publish_year?: number;
  publish_date?: string[];
  isbn?: string[];
  cover_i?: number;
  cover_edition_key?: string;
  number_of_pages_median?: number;
}

interface OpenLibraryResponse {
  docs?: OpenLibraryDoc[];
  numFound?: number;
}

const ENDPOINT = "https://openlibrary.org/search.json";

export async function searchOpenLibraryByAuthor(
  authorName: string,
  limit = 20
): Promise<NormalizedRelease[]> {
  const url = new URL(ENDPOINT);
  url.searchParams.set("author", authorName);
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set(
    "fields",
    "key,title,author_name,first_publish_year,publish_date,isbn,cover_i,cover_edition_key,number_of_pages_median"
  );

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json", "User-Agent": "ShelfAlert/1.0 (self-hosted)" },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Open Library request failed: ${(err as Error).message}`);
  }
  if (!res.ok) {
    throw new Error(`Open Library returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as OpenLibraryResponse;
  const docs = data.docs ?? [];
  return docs
    .map((d) => normalizeDoc(d))
    .filter((r): r is NormalizedRelease => r !== null);
}

function normalizeDoc(d: OpenLibraryDoc): NormalizedRelease | null {
  if (!d.title) return null;

  // Prefer the most specific publish_date, fall back to first_publish_year.
  let publishDate = null;
  if (d.publish_date && d.publish_date.length > 0) {
    // publish_date can contain many strings; pick the latest parseable one.
    const dates = d.publish_date
      .map((s) => parseFlexibleDate(s))
      .filter((x): x is Date => x !== null)
      .sort((a, b) => b.getTime() - a.getTime());
    publishDate = dates[0] ?? null;
  }
  if (!publishDate && d.first_publish_year) {
    publishDate = parseFlexibleDate(String(d.first_publish_year));
  }

  let coverUrl: string | undefined;
  if (d.cover_i) {
    coverUrl = `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg`;
  } else if (d.cover_edition_key) {
    coverUrl = `https://covers.openlibrary.org/b/olid/${d.cover_edition_key}-M.jpg`;
  }

  const openLibraryId = d.key?.replace("/works/", "") ?? undefined;

  return {
    title: d.title,
    isbn13: d.isbn?.find((x) => x.length === 13),
    isbn: d.isbn?.find((x) => x.length === 10),
    publishDate,
    publishDateRaw: d.publish_date?.[0] ?? (d.first_publish_year ? String(d.first_publish_year) : undefined),
    coverUrl,
    pageCount: d.number_of_pages_median,
    openLibraryId,
    dataSource: "open_library",
    authorNames: d.author_name ?? [],
  };
}
