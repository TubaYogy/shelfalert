import { NextRequest } from "next/server";
import { requireSession, ok, fail } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { BookOrbitClient, getBookOrbitToken } from "@/lib/bookorbit";
import { env } from "@/lib/env";

/** GET /api/settings — return settings (password masked, widget URL included). */
export async function GET() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const s = await getSettings();
  return ok({
    bookOrbitUrl: s.bookOrbitUrl,
    bookOrbitInternalUrl: s.bookOrbitInternalUrl,
    bookOrbitUsername: s.bookOrbitUsername,
    hasBookOrbitCredentials: s.hasBookOrbitCredentials,
    hardcoverApiKey: s.hasHardcoverKey ? "configured" : null,
    bookNotificationLogin: s.bookNotificationLogin,
    hasBookNotificationCredentials: s.hasBookNotificationCredentials,
    syncIntervalHours: s.syncIntervalHours,
    lookbackDays: s.lookbackDays,
    lookaheadDays: s.lookaheadDays,
    widgetToken: s.widgetToken,
    widgetJsonUrl: `${env.authUrl}/api/widget/upcoming?token=${s.widgetToken}&limit=5`,
    widgetIframeUrl: `${env.authUrl}/widget?token=${s.widgetToken}`,
    lastBookOrbitSync: s.lastBookOrbitSync,
    lastReleaseSync: s.lastReleaseSync,
    lastSyncStatus: s.lastSyncStatus,
    oidcEnabled: Boolean(env.oidc.clientId && env.oidc.clientSecret && env.oidc.issuer),
  });
}

/** PATCH /api/settings — update settings. */
export async function PATCH(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }

  const s = await updateSettings({
    bookOrbitUrl: body.bookOrbitUrl as string | undefined,
    bookOrbitInternalUrl: body.bookOrbitInternalUrl as string | undefined,
    bookOrbitUsername: body.bookOrbitUsername as string | undefined,
    bookOrbitPassword: body.bookOrbitPassword as string | undefined,
    hardcoverApiKey: body.hardcoverApiKey as string | undefined,
    bookNotificationLogin: body.bookNotificationLogin as string | undefined,
    bookNotificationPassword: body.bookNotificationPassword as string | undefined,
    syncIntervalHours:
      body.syncIntervalHours !== undefined ? Number(body.syncIntervalHours) : undefined,
    lookbackDays: body.lookbackDays !== undefined ? Number(body.lookbackDays) : undefined,
    lookaheadDays: body.lookaheadDays !== undefined ? Number(body.lookaheadDays) : undefined,
    regenerateWidgetToken: body.regenerateWidgetToken === true,
  });

  return ok({
    ok: true,
    widgetToken: s.widgetToken,
    hasBookOrbitCredentials: s.hasBookOrbitCredentials,
  });
}

/**
 * POST /api/settings — test BookOrbit connection.
 * Body: { bookOrbitUrl?, bookOrbitInternalUrl?, bookOrbitUsername?, bookOrbitPassword? }
 * — falls back to stored values. Uses the internal/direct URL when provided so
 * the test matches the real server-side path (bypassing reverse proxy/Authelia).
 * Logs in with username/password to obtain a fresh token, then verifies it against
 * the authors endpoint.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: {
    bookOrbitUrl?: string;
    bookOrbitInternalUrl?: string;
    bookOrbitUsername?: string;
    bookOrbitPassword?: string;
  };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const stored = await getSettings();
  const publicUrl = (body.bookOrbitUrl ?? stored.bookOrbitUrl ?? "").trim().replace(/\/+$/, "");
  const internalUrl = (body.bookOrbitInternalUrl ?? stored.bookOrbitInternalUrl ?? "")
    .trim()
    .replace(/\/+$/, "");
  // Prefer the internal/direct URL — that is what server-side syncs actually use.
  const url = internalUrl || publicUrl;
  const username = (body.bookOrbitUsername ?? stored.bookOrbitUsername ?? "").trim();
  const password = body.bookOrbitPassword?.trim() || stored.bookOrbitPassword || "";

  if (!url || !username || !password) {
    return fail("BookOrbit URL, username and password are all required to test the connection.");
  }

  try {
    const token = await getBookOrbitToken(url, username, password);
    const client = new BookOrbitClient(url, token);
    const result = await client.testConnection();
    return ok({ ok: true, authorCount: result.authorCount });
  } catch (err) {
    return fail(`Connection failed: ${(err as Error).message}`, 502);
  }
}
