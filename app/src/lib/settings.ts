import { prisma } from "./prisma";
import { decrypt, encrypt, generateToken } from "./crypto";

export interface ResolvedSettings {
  id: number;
  bookOrbitUrl: string | null;
  bookOrbitToken: string | null; // decrypted, plaintext
  hasBookOrbitToken: boolean;
  syncIntervalHours: number;
  lookbackDays: number;
  lookaheadDays: number;
  widgetToken: string;
  lastBookOrbitSync: Date | null;
  lastReleaseSync: Date | null;
  lastSyncStatus: string | null;
}

/** Fetch (creating if necessary) the singleton settings row with decrypted token. */
export async function getSettings(): Promise<ResolvedSettings> {
  let row = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!row) {
    row = await prisma.appSettings.create({
      data: { id: 1, widgetToken: generateToken() },
    });
  }
  return {
    id: row.id,
    bookOrbitUrl: row.bookOrbitUrl,
    bookOrbitToken: decrypt(row.bookOrbitToken),
    hasBookOrbitToken: Boolean(row.bookOrbitToken),
    syncIntervalHours: row.syncIntervalHours,
    lookbackDays: row.lookbackDays,
    lookaheadDays: row.lookaheadDays,
    widgetToken: row.widgetToken ?? "",
    lastBookOrbitSync: row.lastBookOrbitSync,
    lastReleaseSync: row.lastReleaseSync,
    lastSyncStatus: row.lastSyncStatus,
  };
}

export interface UpdateSettingsInput {
  bookOrbitUrl?: string | null;
  bookOrbitToken?: string | null; // plaintext; will be encrypted. Empty string clears.
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
  if (input.bookOrbitToken !== undefined) {
    // Only overwrite when a non-empty value is supplied; empty string clears it.
    if (input.bookOrbitToken === "") {
      data.bookOrbitToken = null;
    } else if (input.bookOrbitToken) {
      data.bookOrbitToken = encrypt(input.bookOrbitToken.trim());
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
