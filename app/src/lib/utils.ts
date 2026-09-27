import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Parse the many date formats returned by external book APIs:
 * "2026", "2026-10", "2026-10-15", "October 2026", "2026-10-15T00:00:00Z".
 * Returns a Date (defaulting missing month/day to 01) or null.
 */
export function parseFlexibleDate(input?: string | number | null): Date | null {
  if (input === null || input === undefined) return null;
  const raw = String(input).trim();
  if (!raw) return null;

  // Pure year
  if (/^\d{4}$/.test(raw)) {
    return new Date(Date.UTC(Number(raw), 0, 1));
  }
  // Year-month
  if (/^\d{4}-\d{2}$/.test(raw)) {
    const [y, m] = raw.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, 1));
  }
  // Year-month-day
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    const [y, m, d] = raw.slice(0, 10).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  // Fallback to native parser (e.g. "October 15, 2026")
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed;
  return null;
}

export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return Math.round(ms / (1000 * 60 * 60 * 24));
}

export function formatDate(date: Date | string | null | undefined): string {
  if (!date) return "TBA";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "TBA";
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric",
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Normalise a title for fuzzy comparison (dedupe / library matching). */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // drop parenthetical (e.g. "(Book 3)")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(a|an|the)\b/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIsbn(isbn?: string | null): string {
  if (!isbn) return "";
  return isbn.replace(/[^0-9xX]/g, "").toUpperCase();
}
