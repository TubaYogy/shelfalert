import { NormalizedRelease } from "./google-books";
import { parseFlexibleDate } from "./utils";

/**
 * BookNotification.com CSV import.
 *
 * BookNotification is a WordPress site fronted by a LiteSpeed WAF that blocks
 * every non-browser TLS fingerprint (server-side scraping from Node.js is
 * redirected to /browser-update.html before any session cookie is set), so we
 * cannot log in and scrape the calendar programmatically. Instead the user
 * downloads their book list as a CSV from booknotification.com (My Library →
 * Download / Export CSV) and uploads it here.
 *
 * The CSV columns are:
 *   "Book Title","Author","Series","Release Date"
 * e.g.
 *   "His Wild Blood","Ed James","DI Rob Marshall, #10","2026-08-31"
 *
 * The Series field is "Standalone"/"Collection"/etc for non-series titles and
 * "Series Name, #N" for series entries. Dates are YYYY-MM-DD.
 */

/** Series field values that are categories rather than an actual series name. */
const NON_SERIES = new Set([
  "standalone",
  "collection",
  "non-fiction",
  "nonfiction",
  "graphic novel",
  "anthology",
  "novella",
  "short story",
  "",
]);

const DATE_RE = /\d{4}-\d{2}-\d{2}/;

/* ------------------------------------------------------------------ */
/*  CSV parsing                                                        */
/* ------------------------------------------------------------------ */

/**
 * Parse a single CSV line into fields, honouring double-quoted fields that may
 * contain commas and escaped quotes ("" -> ").
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      fields.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields.map((f) => f.trim());
}

/**
 * Split raw CSV text into logical rows. A quoted field can legally contain
 * newlines, so we track quote state across physical lines.
 */
function splitCsvRows(csvText: string): string[] {
  const rows: string[] = [];
  let cur = "";
  let inQuotes = false;
  const text = csvText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      // Toggle, but handle escaped "" inside quotes.
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
    } else if (ch === "\n" && !inQuotes) {
      if (cur.trim() !== "") rows.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  if (cur.trim() !== "") rows.push(cur);
  return rows;
}

/** Locate a column index by matching any of the given header aliases. */
function findColumn(header: string[], aliases: string[]): number {
  const norm = header.map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  for (const alias of aliases) {
    const a = alias.toLowerCase().replace(/[^a-z]/g, "");
    const idx = norm.indexOf(a);
    if (idx !== -1) return idx;
  }
  return -1;
}

/**
 * Parse a BookNotification CSV export into normalized releases.
 * Expected columns: Book Title, Author, Series, Release Date.
 */
export function parseBookNotificationCsv(csvText: string): NormalizedRelease[] {
  const rows = splitCsvRows(csvText);
  if (rows.length === 0) return [];

  const header = parseCsvLine(rows[0]);
  const looksLikeHeader =
    findColumn(header, ["booktitle", "title", "book"]) !== -1 ||
    findColumn(header, ["author", "authors"]) !== -1;

  let titleIdx = 0;
  let authorIdx = 1;
  let seriesIdx = 2;
  let dateIdx = 3;
  let startRow = 0;

  if (looksLikeHeader) {
    titleIdx = findColumn(header, ["booktitle", "title", "book"]);
    authorIdx = findColumn(header, ["author", "authors"]);
    seriesIdx = findColumn(header, ["series"]);
    dateIdx = findColumn(header, ["releasedate", "date", "publishdate", "pubdate", "released"]);
    startRow = 1;
    if (titleIdx === -1) titleIdx = 0;
    if (authorIdx === -1) authorIdx = 1;
  }

  const byKey = new Map<string, NormalizedRelease>();

  for (let r = startRow; r < rows.length; r++) {
    const cells = parseCsvLine(rows[r]);
    if (cells.length === 0) continue;

    const title = cells[titleIdx] ?? "";
    const author = cells[authorIdx] ?? "";
    const series = seriesIdx >= 0 ? cells[seriesIdx] ?? "" : "";

    // Resolve the date: prefer the mapped column, else find any YYYY-MM-DD cell.
    let dateStr = dateIdx >= 0 ? cells[dateIdx] ?? "" : "";
    if (!DATE_RE.test(dateStr)) {
      const found = cells.find((c) => DATE_RE.test(c));
      dateStr = found ? found.match(DATE_RE)![0] : "";
    } else {
      dateStr = dateStr.match(DATE_RE)![0];
    }
    if (!dateStr) continue;

    const rel = buildRelease(title, author, series, dateStr);
    if (!rel) continue;
    const key = `${rel.title.toLowerCase()}|${(rel.authorNames[0] ?? "").toLowerCase()}|${
      rel.publishDateRaw ?? ""
    }`;
    if (!byKey.has(key)) byKey.set(key, rel);
  }

  return [...byKey.values()];
}

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                     */
/* ------------------------------------------------------------------ */

const TAG_STRIP = /<[^>]+>/g;

/** Decode the handful of HTML entities that appear in book/author fields. */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&#0?38;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?34;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8220;/g, "\u201C")
    .replace(/&#8221;/g, "\u201D")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCharCode(code) : _;
    });
}

function cleanCell(html: string): string {
  return decodeEntities(html.replace(TAG_STRIP, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Parse an HTML calendar table into normalized releases. Retained as a helper
 * in case a future BookNotification export is HTML rather than CSV; the CSV
 * path above is the supported flow.
 */
export function parseCalendarHtml(html: string): NormalizedRelease[] {
  const byKey = new Map<string, NormalizedRelease>();
  const add = (rel: NormalizedRelease | null) => {
    if (!rel) return;
    const key = `${rel.title.toLowerCase()}|${(rel.authorNames[0] ?? "").toLowerCase()}|${
      rel.publishDateRaw ?? ""
    }`;
    if (!byKey.has(key)) byKey.set(key, rel);
  };

  // Strategy 1 — HTML <tr> rows with <td>/<th> cells.
  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      cells.push(cleanCell(cellMatch[1]));
    }
    if (cells.length < 3) continue;

    const dateCell = cells.find((c) => DATE_RE.test(c));
    if (!dateCell) continue;
    const dateStr = dateCell.match(DATE_RE)?.[0];
    if (!dateStr) continue;

    const rest = cells.filter((c) => c !== dateCell);
    const [title, author, series] = rest;
    if (title && author) add(buildRelease(title, author, series ?? "", dateStr));
  }

  // Strategy 2 — JSON embedded in <script type="application/json"> blocks.
  if (byKey.size === 0) {
    const jsonRe = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let m: RegExpExecArray | null;
    while ((m = jsonRe.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(m[1].trim());
        for (const rel of extractFromJson(parsed)) add(rel);
      } catch {
        /* ignore malformed JSON blocks */
      }
    }
  }

  return [...byKey.values()];
}

function buildRelease(
  title: string,
  authorStr: string,
  seriesStr: string,
  dateStr: string
): NormalizedRelease | null {
  const cleanTitle = title.trim();
  const cleanAuthor = authorStr.trim();
  if (!cleanTitle || !cleanAuthor) return null;

  let seriesName: string | undefined;
  let seriesNumber: number | undefined;
  const s = seriesStr.trim();
  if (s && !NON_SERIES.has(s.toLowerCase())) {
    const match = s.match(/^(.*?),\s*#\s*(\d+(?:\.\d+)?)\s*$/);
    if (match) {
      seriesName = match[1].trim() || undefined;
      const n = parseFloat(match[2]);
      if (Number.isFinite(n)) seriesNumber = n;
    } else {
      seriesName = s;
    }
  }

  const authorNames = cleanAuthor
    .split(/,|&| and /i)
    .map((a) => a.trim())
    .filter(Boolean);

  return {
    title: cleanTitle,
    authorNames: authorNames.length > 0 ? authorNames : [cleanAuthor],
    publishDate: parseFlexibleDate(dateStr),
    publishDateRaw: dateStr,
    seriesName,
    seriesNumber,
    dataSource: "booknotification",
  };
}

/** Recursively pull book-like objects out of an arbitrary JSON structure. */
function extractFromJson(data: unknown): NormalizedRelease[] {
  if (Array.isArray(data)) {
    return data.flatMap((item) => extractFromJson(item));
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    const title = obj.title ?? obj.book_title ?? obj.name;
    const author = obj.author ?? obj.author_name ?? obj.authors;
    const date = obj.release_date ?? obj.releaseDate ?? obj.date ?? obj.pub_date;
    if (title && author && date) {
      const authorStr = Array.isArray(author) ? author.join(", ") : String(author);
      const rel = buildRelease(
        String(title),
        authorStr,
        String(obj.series ?? obj.series_name ?? ""),
        String(date)
      );
      return rel ? [rel] : [];
    }
    return Object.values(obj).flatMap((v) => extractFromJson(v));
  }
  return [];
}
