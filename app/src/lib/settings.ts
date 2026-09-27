import { prisma } from "./prisma";
import { decrypt, encrypt, generateToken } from "./crypto";
import { BookOrbitClient, getBookOrbitToken } from "./bookorbit";

export interface ResolvedSettings {
  id: number;
  bookOrbitUrl: string | null;
  bookOrbitInternalUrl: string | null;
  bookOrbitEmail: string | null;
  bookOrbitPassword: string | null; // decrypted, plaintext
  hasBookOrbitCredentials: boolean;
  syncIntervalHours: number;
  lookbackDays: number;
  lookaheadDays: number;
  widgetToken: string;
  lastBookOrbitSync: Date | null;
  lastReleaseSync: Date | null;
  lastSyncStatus: string | null;
}

/** Fetch (creating if necessary) the singleton settings row with decrypted password. */
export async function getSettings(): Promise<ResolvedSettings> {
  let row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.appSettings.create({
      data: { id: 1, widgetToken: generateToken() },
    });
  }
  const password = decrypt(row.bookOrbitPassword);
  return {
    id: row.id,
    bookOrbitUrl: row.bookOrbitUrl,
    bookOrbitInternalUrl: row.bookOrbitInternalUrl,
    bookOrbitEmail: row.bookOrbitEmail,
    bookOrbitPassword: password,
    hasBookOrbitCredentials: Boolean(row.bookOrbitUrl && row.bookOrbitEmail && row.bookOrbitPassword),
    syncIntervalHours: row.syncIntervalHours,
    lookbackDays: row.lookbackDays,
    lookaheadDays: row.lookaheadDays,
    widgetToken: row.widgetToken ?? "",
    lastBookOrbitSync: row.lastBookOrbitSync,
    lastReleaseSync: row.lastReleaseSync,
    lastSyncStatus: row.lastSyncStatus,
  };
}

/**
 * Build a BookOrbitClient using a freshly-obtained token.
 * BookOrbit JWTs expire after ~15 minutes, so we log in on demand each time.
 * Returns null when credentials are not fully configured.
 */
export async function getBookOrbitClient(): Promise<BookOrbitClient | null> {
  const s = await getSettings();
  if (!s.bookOrbitUrl || !s.bookOrbitEmail || !s.bookOrbitPassword) {
    return null;
  }
  // Prefer the internal/direct URL for server-side calls so we bypass any
  // reverse proxy / SSO (e.g. Caddy + Authelia) sitting in front of BookOrbit.
  const apiUrl = s.bookOrbitInternalUrl || s.bookOrbitUrl;
  const token = await getBookOrbitToken(apiUrl, s.bookOrbitEmail, s.bookOrbitPassword);
  return new BookOrbitClient(apiUrl, token);
}

export interface UpdateSettingsInput {
  bookOrbitUrl?: string | null;
  bookOrbitInternalUrl?: string | null;
  bookOrbitEmail?: string | null;
  bookOrbitPassword?: string | null; // plaintext; will be encrypted. Empty string clears.
  syncIntervalHours?: number;
  lookbackDays?: number;
  lookaheadDays?: number;
  regenerateWidgetToken?: boolean;
}

export async function updateSettings(input: UpdateSettingsInput): Promise<ResolvedSettings> {
  const data: Record<string, unknown> = {};

  if (input.bookOrbitUrl !== undefined) {
    data.bookOrbitUrl = input.bookOrbitUrl?.trim().replace(/\/+$/, "") || null;
  }
  if (input.bookOrbitInternalUrl !== undefined) {
    data.bookOrbitInternalUrl = input.bookOrbitInternalUrl?.trim().replace(/\/+$/, "") || null;
  }
  if (input.bookOrbitEmail !== undefined) {
    data.bookOrbitEmail = input.bookOrbitEmail?.trim() || null;
  }
  if (input.bookOrbitPassword !== undefined) {
    // Only overwrite when a non-empty value is supplied; empty string clears it.
    if (input.bookOrbitPassword === "") {
      data.bookOrbitPassword = null;
    } else if (input.bookOrbitPassword) {
      data.bookOrbitPassword = encrypt(input.bookOrbitPassword.trim());
    }
  }
  if (input.syncIntervalHours !== undefined) {
    data.syncIntervalHours = clampInt(input.syncIntervalHours, 1, 168, 24);
  }
  if (input.lookbackDays !== undefined) {
    data.lookbackDays = clampInt(input.lookbackDays, 0, 3650, 60);
  }
  if (input.lookaheadDays !== undefined) {
    data.lookaheadDays = clampInt(input.lookaheadDays, 0, 3650, 90);
  }
  if (input.regenerateWidgetToken) {
    data.widgetToken = generateToken();
  }

  await prisma.appSettings.upsert({
    where: { id: 1 },
    update: data,
    create: { id: 1, widgetToken: generateToken(), ...data },
  });

  return getSettings();
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
