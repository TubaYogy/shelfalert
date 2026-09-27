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
    bookOrbitEmail: s.bookOrbitEmail,
    hasBookOrbitCredentials: s.hasBookOrbitCredentials,
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
    bookOrbitEmail: body.bookOrbitEmail as string | undefined,
    bookOrbitPassword: body.bookOrbitPassword as string | undefined,
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
 * Body: { bookOrbitUrl?, bookOrbitEmail?, bookOrbitPassword? } — falls back to
 * stored values. Logs in with email/password to obtain a fresh token, then
 * verifies it against the authors endpoint.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: { bookOrbitUrl?: string; bookOrbitEmail?: string; bookOrbitPassword?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const stored = await getSettings();
  const url = (body.bookOrbitUrl ?? stored.bookOrbitUrl ?? "").trim().replace(/\/+$/, "");
  const email = (body.bookOrbitEmail ?? stored.bookOrbitEmail ?? "").trim();
  const password = body.bookOrbitPassword?.trim() || stored.bookOrbitPassword || "";

  if (!url || !email || !password) {
    return fail("BookOrbit URL, email and password are all required to test the connection.");
  }

  try {
    const token = await getBookOrbitToken(url, email, password);
    const client = new BookOrbitClient(url, token);
    const result = await client.testConnection();
    return ok({ ok: true, authorCount: result.authorCount });
  } catch (err) {
    return fail(`Connection failed: ${(err as Error).message}`, 502);
  }
}
