import { prisma } from "./prisma";
import { getSettings, getBookOrbitClient } from "./settings";
import { BookOrbitClient, buildLibraryIndex } from "./bookorbit";
import { searchGoogleBooksByAuthor, NormalizedRelease } from "./google-books";
import { searchOpenLibraryByAuthor } from "./open-library";
import { daysBetween, normalizeIsbn, normalizeTitle, sleep } from "./utils";
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

  for (const s of series) {
    const gaps = Array.isArray(s.gaps) ? s.gaps : [];
    if (gaps.length === 0) continue;
    const authorName = s.authors && s.authors.length > 0 ? s.authors.join(", ") : undefined;

    for (const n of gaps) {
      if (!Number.isFinite(n) || !Number.isInteger(n)) continue;
      await prisma.seriesGap.upsert({
        where: { seriesName_missingNumber: { seriesName: s.name, missingNumber: n } },
        update: { authorName, bookOrbitSeriesId: s.id },
        create: {
          seriesName: s.name,
          authorName,
          missingNumber: n,
          bookOrbitSeriesId: s.id,
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
      const candidates = await gatherReleasesForAuthor(author.name);

      // Build the "already owned" index from BookOrbit, if available.
      let libIndex = { titles: new Set<string>(), isbns: new Set<string>() };
      if (boClient && author.bookOrbitId) {
        try {
          const books = await boClient.getAuthorBooks(author.bookOrbitId);
          libIndex = buildLibraryIndex(books);
        } catch (err) {
          errors.push(`Library lookup for ${author.name}: ${(err as Error).message}`);
        }
      }

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
    } catch (err) {
      errors.push(`${author.name}: ${(err as Error).message}`);
    }
    await sleep(RATE_LIMIT_MS);
  }

  // Prune releases that fell outside the window on this run.
  await prisma.release.deleteMany({
    where: {
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

/** Google Books first; fall back to Open Library when few results returned. */
async function gatherReleasesForAuthor(authorName: string): Promise<NormalizedRelease[]> {
  let results: NormalizedRelease[] = [];
  try {
    results = await searchGoogleBooksByAuthor(authorName, 40);
  } catch {
    results = [];
  }

  if (results.length < 5) {
    try {
      const ol = await searchOpenLibraryByAuthor(authorName, 20);
      results = dedupe([...results, ...ol]);
    } catch {
      /* ignore secondary source failures */
    }
  }
  return dedupe(results);
}

function dedupe(items: NormalizedRelease[]): NormalizedRelease[] {
  const seen = new Map<string, NormalizedRelease>();
  for (const item of items) {
    const isbnKey = normalizeIsbn(item.isbn13) || normalizeIsbn(item.isbn);
    const key = isbnKey || normalizeTitle(item.title);
    if (!key) continue;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else if (!existing.coverUrl && item.coverUrl) {
      // Prefer the record that has a cover image.
      seen.set(key, { ...existing, coverUrl: item.coverUrl });
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
      create: { ...data, googleBooksId: rel.googleBooksId, openLibraryId: rel.openLibraryId ?? null },
    });
    return;
  }
  if (rel.openLibraryId) {
    await prisma.release.upsert({
      where: { openLibraryId: rel.openLibraryId },
      update: data,
      create: { ...data, openLibraryId: rel.openLibraryId },
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
