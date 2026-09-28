import { parseFlexibleDate, sleep } from "./utils";

/**
 * Google Books API client (free, no API key required for basic volume search).
 * https://www.googleapis.com/books/v1/volumes?q=inauthor:"Name"&orderBy=newest
 */

export interface NormalizedRelease {
  title: string;
  isbn?: string;
  isbn13?: string;
  publishDate: Date | null;
  publishDateRaw?: string;
  coverUrl?: string;
  description?: string;
  pageCount?: number;
  seriesName?: string;
  seriesNumber?: number;
  googleBooksId?: string;
  openLibraryId?: string;
  hardcoverId?: string;
  dataSource: "google_books" | "open_library" | "hardcover" | "bookorbit";
  authorNames: string[];
}

interface GoogleVolume {
  id: string;
  volumeInfo?: {
    title?: string;
    authors?: string[];
    publishedDate?: string;
    description?: string;
    pageCount?: number;
    industryIdentifiers?: { type: string; identifier: string }[];
    imageLinks?: { thumbnail?: string; smallThumbnail?: string };
  };
}

interface GoogleResponse {
  items?: GoogleVolume[];
  totalItems?: number;
}

const GOOGLE_ENDPOINT = "https://www.googleapis.com/books/v1/volumes";

export async function searchGoogleBooksByAuthor(
  authorName: string,
  maxResults = 40,
  startIndex = 0
): Promise<NormalizedRelease[]> {
  const url = new URL(GOOGLE_ENDPOINT);
  url.searchParams.set("q", `inauthor:"${authorName}"`);
  url.searchParams.set("orderBy", "newest");
  url.searchParams.set("maxResults", String(Math.min(40, maxResults)));
  url.searchParams.set("printType", "books");
  if (startIndex > 0) {
    url.searchParams.set("startIndex", String(startIndex));
  }
  if (process.env.GOOGLE_BOOKS_API_KEY) {
    url.searchParams.set("key", process.env.GOOGLE_BOOKS_API_KEY);
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
      cache: "no-store",
    });
  } catch (err) {
    throw new Error(`Google Books request failed: ${(err as Error).message}`);
  }

  if (res.status === 429) {
    // Rate limited — back off once and retry.
    await sleep(2000);
    res = await fetch(url.toString(), { headers: { Accept: "application/json" }, cache: "no-store" });
  }
  if (!res.ok) {
    throw new Error(`Google Books returned HTTP ${res.status}`);
  }

  const data = (await res.json()) as GoogleResponse;
  const items = data.items ?? [];
  return items
    .map((v) => normalizeVolume(v))
    .filter((r): r is NormalizedRelease => r !== null);
}

function normalizeVolume(v: GoogleVolume): NormalizedRelease | null {
  const info = v.volumeInfo;
  if (!info?.title) return null;

  let isbn: string | undefined;
  let isbn13: string | undefined;
  for (const id of info.industryIdentifiers ?? []) {
    if (id.type === "ISBN_10") isbn = id.identifier;
    if (id.type === "ISBN_13") isbn13 = id.identifier;
  }

  const cover =
    info.imageLinks?.thumbnail?.replace(/^http:/, "https:") ??
    info.imageLinks?.smallThumbnail?.replace(/^http:/, "https:");

  const { seriesName, seriesNumber } = extractSeries(info.title);

  return {
    title: info.title,
    isbn,
    isbn13,
    publishDate: parseFlexibleDate(info.publishedDate),
    publishDateRaw: info.publishedDate,
    coverUrl: cover,
    description: info.description,
    pageCount: info.pageCount,
    seriesName,
    seriesNumber,
    googleBooksId: v.id,
    dataSource: "google_books",
    authorNames: info.authors ?? [],
  };
}

/**
 * Attempt to derive a series name/number from a title like
 * "The Book Title (Series Name, #3)" or "Series Name Book 3".
 */
export function extractSeries(title: string): {
  seriesName?: string;
  seriesNumber?: number;
} {
  // Pattern: "(Series Name, #3)" or "(Series Name #3)" or "(Series Name, Book 3)"
  const paren = title.match(/\(([^)]*?)[,]?\s*(?:#|book\s*)(\d+(?:\.\d+)?)\)/i);
  if (paren) {
    return {
      seriesName: paren[1].replace(/[,\s]+$/, "").trim() || undefined,
      seriesNumber: Number(paren[2]),
    };
  }
  return {};
}
