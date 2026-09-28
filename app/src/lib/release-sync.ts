import { prisma } from "./prisma";
import { getSettings, getBookOrbitClient } from "./settings";
import { BookOrbitClient, BookOrbitBook, buildLibraryIndex } from "./bookorbit";
import { searchGoogleBooksByAuthor, NormalizedRelease } from "./google-books";
import { searchOpenLibraryByAuthor } from "./open-library";
import { searchHardcoverByAuthor, lookupSeriesBookTitles } from "./hardcover";
import type { Author } from "@prisma/client";
import type { ResolvedSettings } from "./settings";
import { daysBetween, normalizeIsbn, normalizeTitle, parseFlexibleDate, sleep } from "./utils";
import type { ReleaseStatus } from "@prisma/client";

export interface SyncResult {
  ok: boolean;
  message: string;
  authorsSynced?: number;
  releasesUpserted?: number;
  missingCount?: number;
  seriesGaps?: number;
  errors: string[];
  startedAt: string;
  finishedAt: string;
}

/** Delay between author API calls to be respectful to external services. */
const RATE_LIMIT_MS = 500;

/* ------------------------------------------------------------------ */
/*  BookOrbit author sync                                              */
/* ------------------------------------------------------------------ */

export async function syncAuthorsFromBookOrbit(): Promise<SyncResult> {
  const startedAt = new Date();
  const errors: string[] = [];

  let client: BookOrbitClient | null;
  try {
    client = await getBookOrbitClient();
  } catch (err) {
    const msg = (err as Error).message;
    return finalize(startedAt, {
      ok: false,
      message: `BookOrbit login failed: ${msg}`,
      errors: [msg],
    });
  }

  if (!client) {
    return finalize(startedAt, {
      ok: false,
      message: "BookOrbit URL / email / password not configured in Settings.",
      errors: ["BookOrbit not configured"],
    });
  }

  let authorsSynced = 0;

  try {
    const authors = await client.getAllAuthors();
    for (const a of authors) {
      await prisma.author.upsert({
        where: { bookOrbitId: a.id },
        update: {
          name: a.name,
          sortName: a.sortName ?? undefined,
          photoUrl: a.imageUrl ?? undefined,
          source: "bookorbit",
        },
        create: {
          name: a.name,
          sortName: a.sortName ?? undefined,
          photoUrl: a.imageUrl ?? undefined,
          bookOrbitId: a.id,
          source: "bookorbit",
        },
      });
      authorsSynced += 1;
    }
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { lastBookOrbitSync: new Date(), lastSyncStatus: `Synced ${authorsSynced} authors` },
    });
  } catch (err) {
    const msg = (err as Error).message;
    errors.push(msg);
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { lastSyncStatus: `BookOrbit sync failed: ${msg}` },
    });
    return finalize(startedAt, {
      ok: false,
      message: `BookOrbit author sync failed: ${msg}`,
      authorsSynced,
      errors,
    });
  }

  // Also detect series gaps from BookOrbit series data (best-effort).
  let seriesGaps = 0;
  try {
    seriesGaps = await detectSeriesGaps(client);
  } catch (err) {
    errors.push(`Series gap detection: ${(err as Error).message}`);
  }

  return finalize(startedAt, {
    ok: true,
    message: `Synced ${authorsSynced} authors from BookOrbit.`,
    authorsSynced,
    seriesGaps,
    errors,
  });
}

/* ------------------------------------------------------------------ */
/*  Series gap detection                                              */
/* ------------------------------------------------------------------ */

export async function detectSeriesGaps(client: BookOrbitClient): Promise<number> {
  // BookOrbit computes and exposes missing volume numbers per series directly
  // (SeriesSummary.gaps), so we trust its own gap detection rather than
  // re-deriving it from the volume list. This avoids an N+1 call per series.
  const series = await client.getAllSeries();
  // Reset existing gaps; recompute fresh.
  await prisma.seriesGap.deleteMany({});
  let gapCount = 0;

  // Fetch Hardcover API key once — used to enrich gap titles (best-effort).
  const settings = await getSettings();
  const hardcoverKey = settings.hardcoverApiKey ?? null;

  for (const s of series) {
    const gaps = Array.isArray(s.gaps) ? s.gaps : [];
    if (gaps.length === 0) continue;
    const authorName = s.authors && s.authors.length > 0 ? s.authors.join(", ") : undefined;

    // Attempt Hardcover title lookup for this series (only when key is configured).
    let titleMap = new Map<number, string>();
    if (hardcoverKey) {
      try {
        titleMap = await lookupSeriesBookTitles(s.name, hardcoverKey);
        // Space calls to respect Hardcover's 60 req/min limit.
        await sleep(1100);
      } catch {
        /* best-effort — continue without titles */
      }
    }

    for (const n of gaps) {
      if (!Number.isFinite(n) || !Number.isInteger(n)) continue;
      const expectedTitle = titleMap.get(n) ?? null;
      await prisma.seriesGap.upsert({
        where: { seriesName_missingNumber: { seriesName: s.name, missingNumber: n } },
        update: { authorName, bookOrbitSeriesId: s.id, ...(expectedTitle ? { expectedTitle } : {}) },
        create: {
          seriesName: s.name,
          authorName,
          missingNumber: n,
          bookOrbitSeriesId: s.id,
          expectedTitle,
        },
      });
      gapCount += 1;
    }
  }
  return gapCount;
}

/* ------------------------------------------------------------------ */
/*  Release sync (Google Books + Open Library)                        */
/* ------------------------------------------------------------------ */

export async function syncReleases(): Promise<SyncResult> {
  const startedAt = new Date();
  const errors: string[] = [];
  const settings = await getSettings();

  const now = new Date();
  const lookback = new Date(now.getTime() - settings.lookbackDays * 86400000);
  const lookahead = new Date(now.getTime() + settings.lookaheadDays * 86400000);

  const authors = await prisma.author.findMany({ where: { isActive: true } });
  if (authors.length === 0) {
    return finalize(startedAt, {
      ok: false,
      message: "No active authors to sync. Add authors or sync from BookOrbit first.",
      errors: ["No active authors"],
    });
  }

  // Optional BookOrbit client for library cross-referencing.
  // Logs in with stored email/password to obtain a fresh token (best-effort).
  let boClient: BookOrbitClient | null = null;
  try {
    boClient = await getBookOrbitClient();
  } catch (err) {
    errors.push(`BookOrbit login for library lookup: ${(err as Error).message}`);
  }

  let releasesUpserted = 0;
  let missingCount = 0;

  for (const author of authors) {
    try {
      const candidates = await gatherReleasesForAuthor(author.name, author, settings);

      // Build the "already owned" index from BookOrbit, if available.
      // Keep the raw books array so we can scan it directly for RECENT entries.
      let libIndex = { titles: new Set<string>(), isbns: new Set<string>() };
      let boBooks: BookOrbitBook[] = [];
      if (boClient && author.bookOrbitId) {
        try {
          boBooks = await boClient.getAuthorBooks(author.bookOrbitId);
          libIndex = buildLibraryIndex(boBooks);
        } catch (err) {
          errors.push(`Library lookup for ${author.name}: ${(err as Error).message}`);
        }
      }

      // Phase 1: upsert books found by external APIs (GB / OL / Hardcover).
      for (const rel of candidates) {
        const pd = rel.publishDate;
        // Filter to the configured window (skip items with no date entirely).
        if (!pd) continue;
        if (pd < lookback || pd > lookahead) continue;

        const inLibrary = isInLibrary(rel, libIndex);
        const status = computeStatus(pd, now, inLibrary);
        if (status === "MISSING") missingCount += 1;

        await upsertRelease(author.id, rel, status, inLibrary);
        releasesUpserted += 1;
      }

      // Phase 2: direct BookOrbit RECENT scan.
      // Books the user already owns in BookOrbit with a recent publish date should
      // always appear as RECENT — regardless of whether Google Books returned them.
      // This is the most reliable source for "recently released books I have".
      for (const book of boBooks) {
        if (!book.title) continue;
        // Parse the most specific date BookOrbit has.
        const pd = parseFlexibleDate(
          book.publishedDate ??
            (book.publishedYear != null ? String(book.publishedYear) : null)
        );
        if (!pd) continue;
        // Only consider books published within the lookback window (past books the
        // user owns). Upcoming books are handled by the external-API phase.
        if (pd < lookback || pd > now) continue;

        // Try to find an existing Release record for this book (created above by
        // the GB/OL/HC phase) — update its status rather than duplicating.
        const isbn13Norm = normalizeIsbn(book.isbn13);
        const existing = await prisma.release.findFirst({
          where: {
            authorId: author.id,
            OR: [
              ...(isbn13Norm ? [{ isbn13: isbn13Norm }] : []),
              { title: book.title },
            ],
          },
        });

        if (existing) {
          // Correct the status to RECENT + inLibrary=true if needed.
          if (!existing.inLibrary || existing.status !== "RECENT") {
            await prisma.release.update({
              where: { id: existing.id },
              data: { inLibrary: true, status: "RECENT" },
            });
          }
        } else {
          // Not found via external APIs — create directly from BookOrbit data.
          const seriesNum = book.seriesIndex ? parseFloat(book.seriesIndex) : null;
          await prisma.release.create({
            data: {
              title: book.title,
              authorId: author.id,
              isbn13: book.isbn13 ?? null,
              publishDate: pd,
              seriesName: book.seriesName ?? null,
              seriesNumber: seriesNum != null && !isNaN(seriesNum) ? seriesNum : null,
              inLibrary: true,
              status: "RECENT",
              dataSource: "bookorbit",
            },
          });
          releasesUpserted += 1;
        }
      }
    } catch (err) {
      errors.push(`${author.name}: ${(err as Error).message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Prune releases that fell outside the window on this run.
  // Never prune books the user actually owns in their library — those are always
  // kept regardless of the lookback window (they show as RECENT).
  await prisma.release.deleteMany({
    where: {
      inLibrary: false,
      OR: [
        { publishDate: { lt: lookback } },
        { publishDate: { gt: lookahead } },
        { publishDate: null },
      ],
    },
  });

  await prisma.appSettings.update({
    where: { id: 1 },
    data: {
      lastReleaseSync: new Date(),
      lastSyncStatus: `Refreshed ${releasesUpserted} releases (${missingCount} missing)`,
    },
  });

  return finalize(startedAt, {
    ok: true,
    message: `Refreshed ${releasesUpserted} releases across ${authors.length} authors.`,
    releasesUpserted,
    missingCount,
    errors,
  });
}

/**
 * Gather candidate releases for an author from all configured data sources.
 * Google Books (up to 2 pages = 80 results); Open Library when GB returns
 * fewer than 20 results; Hardcover when an API key is configured.
 */
async function gatherReleasesForAuthor(
  authorName: string,
  author?: Author,
  settings?: ResolvedSettings
): Promise<NormalizedRelease[]> {
  // Page 1 of Google Books (max 40 per request — API hard limit).
  let gbPage1: NormalizedRelease[] = [];
  try {
    gbPage1 = await searchGoogleBooksByAuthor(authorName, 40, 0);
  } catch {
    gbPage1 = [];
  }

  // Page 2: fetch only when page 1 was full (there are likely more results).
  let gbPage2: NormalizedRelease[] = [];
  if (gbPage1.length === 40) {
    try {
      gbPage2 = await searchGoogleBooksByAuthor(authorName, 40, 40);
    } catch {
      gbPage2 = [];
    }
  }

  let results = dedupe([...gbPage1, ...gbPage2]);

  // Open Library as a supplement when Google Books coverage is thin
  // (raised threshold from 5 → 20 to catch more gaps).
  if (results.length < 20) {
    try {
      const ol = await searchOpenLibraryByAuthor(authorName, 40);
      results = dedupe([...results, ...ol]);
    } catch {
      /* ignore secondary source failures */
    }
  }

  // Hardcover — optional third source, only when an API key is configured.
  if (settings?.hardcoverApiKey) {
    try {
      const { releases, resolvedAuthorId } = await searchHardcoverByAuthor(
        authorName,
        settings.hardcoverApiKey,
        author?.hardcoverAuthorId ?? null
      );
      // Cache the resolved Hardcover author id when it changed.
      if (author && resolvedAuthorId && resolvedAuthorId !== author.hardcoverAuthorId) {
        try {
          await prisma.author.update({
            where: { id: author.id },
            data: { hardcoverAuthorId: resolvedAuthorId },
          });
        } catch {
          /* ignore cache-update failures (e.g. unique conflict) */
        }
      }
      results = dedupe([...results, ...releases]);
    } catch {
      /* ignore Hardcover source failures */
    }
    // Respect Hardcover's 60 req/min limit.
    await sleep(1100);
  }

  return dedupe(results);
}

function dedupe(items: NormalizedRelease[]): NormalizedRelease[] {
  const seen = new Map<string, NormalizedRelease>();
  const now = new Date();
  for (const item of items) {
    const isbnKey = normalizeIsbn(item.isbn13) || normalizeIsbn(item.isbn);
    const key = isbnKey || normalizeTitle(item.title);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else {
      // Prefer the record with an upcoming (future) publish date.
      const itemDate = item.publishDate ? new Date(item.publishDate) : null;
      const existingDate = existing.publishDate ? new Date(existing.publishDate) : null;
      const itemIsFuture = itemDate !== null && itemDate > now;
      const existingIsFuture = existingDate !== null && existingDate > now;

      let preferred: NormalizedRelease;
      if (itemIsFuture && !existingIsFuture) {
        preferred = item;
      } else if (!itemIsFuture && existingIsFuture) {
        preferred = existing;
      } else {
        preferred = existing; // unchanged
      }

      // Supplement: carry over a cover image from whichever side has one.
      if (!preferred.coverUrl) {
        const other = preferred === existing ? item : existing;
        if (other.coverUrl) preferred = { ...preferred, coverUrl: other.coverUrl };
      }
      seen.set(key, preferred);
    }
  }
  return [...seen.values()];
}

function isInLibrary(
  rel: NormalizedRelease,
  index: { titles: Set<string>; isbns: Set<string> }
): boolean {
  const i13 = normalizeIsbn(rel.isbn13);
  const i10 = normalizeIsbn(rel.isbn);
  if (i13 && index.isbns.has(i13)) return true;
  if (i10 && index.isbns.has(i10)) return true;
  if (index.titles.has(normalizeTitle(rel.title))) return true;
  return false;
}

function computeStatus(publishDate: Date, now: Date, inLibrary: boolean): ReleaseStatus {
  if (publishDate.getTime() > now.getTime()) return "UPCOMING";
  // Past release
  return inLibrary ? "RECENT" : "MISSING";
}

async function upsertRelease(
  authorId: number,
  rel: NormalizedRelease,
  status: ReleaseStatus,
  inLibrary: boolean
): Promise<void> {
  const data = {
    title: rel.title,
    authorId,
    isbn: rel.isbn ?? null,
    isbn13: rel.isbn13 ?? null,
    publishDate: rel.publishDate,
    seriesName: rel.seriesName ?? null,
    seriesNumber: rel.seriesNumber ?? null,
    coverUrl: rel.coverUrl ?? null,
    description: rel.description ?? null,
    pageCount: rel.pageCount ?? null,
    inLibrary,
    status,
    dataSource: rel.dataSource,
  };

  // Prefer stable external IDs as the unique key.
  if (rel.googleBooksId) {
    await prisma.release.upsert({
      where: { googleBooksId: rel.googleBooksId },
      update: data,
      create: {
        ...data,
        googleBooksId: rel.googleBooksId,
        openLibraryId: rel.openLibraryId ?? null,
        hardcoverId: rel.hardcoverId ?? null,
      },
    });
    return;
  }
  if (rel.openLibraryId) {
    await prisma.release.upsert({
      where: { openLibraryId: rel.openLibraryId },
      update: data,
      create: { ...data, openLibraryId: rel.openLibraryId, hardcoverId: rel.hardcoverId ?? null },
    });
    return;
  }
  if (rel.hardcoverId) {
    await prisma.release.upsert({
      where: { hardcoverId: rel.hardcoverId },
      update: data,
      create: { ...data, hardcoverId: rel.hardcoverId },
    });
    return;
  }

  // No external id — match on author + title to avoid duplicates.
  const existing = await prisma.release.findFirst({
    where: { authorId, title: rel.title },
  });
  if (existing) {
    await prisma.release.update({ where: { id: existing.id }, data });
  } else {
    await prisma.release.create({ data });
  }
}

/* ------------------------------------------------------------------ */
/*  Full sync (authors + releases)                                    */
/* ------------------------------------------------------------------ */

export async function runFullSync(): Promise<SyncResult> {
  const startedAt = new Date();
  const errors: string[] = [];

  const authorResult = await syncAuthorsFromBookOrbit();
  if (!authorResult.ok) {
    // BookOrbit might be down — continue with existing authors anyway.
    errors.push(...authorResult.errors);
  }

  const releaseResult = await syncReleases();
  errors.push(...releaseResult.errors);

  return finalize(startedAt, {
    ok: releaseResult.ok,
    message: `${authorResult.message} ${releaseResult.message}`.trim(),
    authorsSynced: authorResult.authorsSynced,
    releasesUpserted: releaseResult.releasesUpserted,
    missingCount: releaseResult.missingCount,
    seriesGaps: authorResult.seriesGaps,
    errors,
  });
}

function finalize(
  startedAt: Date,
  partial: Omit<SyncResult, "startedAt" | "finishedAt">
): SyncResult {
  const finishedAt = new Date();
  return {
    ...partial,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
  };
}

/** Recompute statuses (e.g. an UPCOMING book whose date has now passed). */
export async function recomputeStatuses(): Promise<void> {
  const now = new Date();
  const releases = await prisma.release.findMany({
    where: { publishDate: { not: null } },
    select: { id: true, publishDate: true, inLibrary: true, status: true },
  });
  for (const r of releases) {
    if (!r.publishDate) continue;
    const next = computeStatus(r.publishDate, now, r.inLibrary);
    if (next !== r.status) {
      await prisma.release.update({ where: { id: r.id }, data: { status: next } });
    }
  }
}

export { daysBetween };
