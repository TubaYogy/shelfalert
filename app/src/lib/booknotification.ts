import { NormalizedRelease } from "./google-books";
import { parseFlexibleDate } from "./utils";

/**
 * BookNotification.com scraper.
 *
 * BookNotification is a WordPress site with no public JSON/GraphQL API, so we
 * log in via the standard `wp-login.php` form POST and scrape the authenticated
 * "book calendar" HTML page.
 *
 * The calendar rows mirror the CSV export the user can download:
 *   Book Title | Author | Series ("Name, #N" / "Standalone" / "Collection") | Release Date (YYYY-MM-DD)
 *
 * Parsing is intentionally defensive — the WordPress theme markup can change, so
 * we try several strategies (HTML table rows, embedded JSON, definition lists)
 * and, when nothing matches, surface a snippet of the returned HTML so the
 * failure is diagnosable.
 */

const BN_BASE = "https://www.booknotification.com";
const CALENDAR_PATH = "/my-library/book-calendar/";

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-GB,en;q=0.9",
};

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

/** Read all Set-Cookie headers in a runtime-portable way. */
function readSetCookies(headers: Headers): string[] {
  // Node 18.14+ / undici expose getSetCookie(); fall back to the single header.
  const anyHeaders = headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") {
    return anyHeaders.getSetCookie();
  }
  const single = headers.get("set-cookie");
  return single ? [single] : [];
}

/** Merge Set-Cookie values into a single Cookie request-header string. */
function collectCookies(existing: Map<string, string>, headers: Headers): void {
  for (const raw of readSetCookies(headers)) {
    const pair = raw.split(";")[0];
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!name) continue;
    // A cookie set to "deleted" or empty means WordPress is clearing it.
    if (value === "" || value.toLowerCase() === "deleted") {
      existing.delete(name);
    } else {
      existing.set(name, value);
    }
  }
}

function cookieHeader(jar: Map<string, string>): string {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Log into BookNotification and return a cookie jar containing the WordPress
 * session cookies. Throws with a clear message when login clearly failed.
 */
async function loginToBookNotification(
  userLogin: string,
  userPass: string
): Promise<Map<string, string>> {
  const jar = new Map<string, string>();

  // 1) Prime the WordPress "test cookie" by GETting the login page first.
  try {
    const pre = await fetch(`${BN_BASE}/wp-login.php`, {
      headers: BROWSER_HEADERS,
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    collectCookies(jar, pre.headers);
  } catch {
    /* non-fatal — proceed to POST anyway */
  }
  if (!jar.has("wordpress_test_cookie")) {
    jar.set("wordpress_test_cookie", "WP+Cookie+check");
  }

  const body = new URLSearchParams({
    log: userLogin,
    pwd: userPass,
    // Some WP setups use log/pwd, others user_login/user_pass — send both.
    user_login: userLogin,
    user_pass: userPass,
    rememberme: "forever",
    "wp-submit": "Log In",
    redirect_to: `${BN_BASE}${CALENDAR_PATH}`,
    testcookie: "1",
  });

  const res = await fetch(`${BN_BASE}/wp-login.php`, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      Referer: `${BN_BASE}/wp-login.php`,
      Origin: BN_BASE,
      Cookie: cookieHeader(jar),
    },
    body: body.toString(),
    redirect: "manual", // WordPress 302-redirects on a successful login.
    signal: AbortSignal.timeout(30000),
  });

  collectCookies(jar, res.headers);

  const loggedIn = [...jar.keys()].some((k) => k.startsWith("wordpress_logged_in"));
  if (!loggedIn) {
    // Fall back to the pretty /login/ route if it exists on this install.
    throw new Error(
      "BookNotification login failed — no session cookie returned (check the login/email and password in Settings)."
    );
  }
  return jar;
}

/**
 * Log into BookNotification.com and scrape the upcoming book calendar.
 * Returns a normalized release for every parseable row.
 */
export async function scrapeBookNotificationCalendar(
  userLogin: string,
  userPass: string
): Promise<NormalizedRelease[]> {
  const jar = await loginToBookNotification(userLogin, userPass);

  // Follow up to 3 redirects manually while carrying cookies along.
  let url = `${BN_BASE}${CALENDAR_PATH}`;
  let html = "";
  for (let hop = 0; hop < 4; hop++) {
    const res: Response = await fetch(url, {
      headers: {
        ...BROWSER_HEADERS,
        Cookie: cookieHeader(jar),
        Referer: `${BN_BASE}/`,
      },
      redirect: "manual",
      signal: AbortSignal.timeout(30000),
    });
    collectCookies(jar, res.headers);

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) break;
      url = loc.startsWith("http") ? loc : `${BN_BASE}${loc.startsWith("/") ? "" : "/"}${loc}`;
      continue;
    }
    if (!res.ok) {
      throw new Error(`BookNotification calendar returned HTTP ${res.status}`);
    }
    html = await res.text();
    break;
  }

  if (!html) {
    throw new Error("BookNotification calendar returned an empty response");
  }

  const releases = parseCalendarHtml(html);
  if (releases.length === 0) {
    const snippet = html.replace(/\s+/g, " ").slice(0, 2000);
    throw new Error(
      `No releases parsed from the BookNotification calendar — the page structure may have changed. HTML preview: ${snippet}`
    );
  }
  return releases;
}

/* ------------------------------------------------------------------ */
/*  HTML parsing                                                       */
/* ------------------------------------------------------------------ */

const TAG_STRIP = /<[^>]+>/g;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;

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

    // Non-date cells, in order, map to: title, author, series.
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
