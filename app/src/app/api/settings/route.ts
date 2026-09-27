import { NextRequest } from "next/server";
import { requireSession, ok, fail } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { BookOrbitClient } from "@/lib/bookorbit";
import { env } from "@/lib/env";

/** GET /api/settings — return settings (token masked, widget URL included). */
export async function GET() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const s = await getSettings();
  return ok({
    bookOrbitUrl: s.bookOrbitUrl,
    hasBookOrbitToken: s.hasBookOrbitToken,
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
    bookOrbitToken: body.bookOrbitToken as string | undefined,
    syncIntervalHours:
      body.syncIntervalHours !== undefined ? Number(body.syncIntervalHours) : undefined,
    lookbackDays: body.lookbackDays !== undefined ? Number(body.lookbackDays) : undefined,
    lookaheadDays: body.lookaheadDays !== undefined ? Number(body.lookaheadDays) : undefined,
    regenerateWidgetToken: body.regenerateWidgetToken === true,
  });

  return ok({
    ok: true,
    widgetToken: s.widgetToken,
    hasBookOrbitToken: s.hasBookOrbitToken,
  });
}

/**
 * POST /api/settings — test BookOrbit connection.
 * Body: { bookOrbitUrl?, bookOrbitToken? } — falls back to stored values.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: { bookOrbitUrl?: string; bookOrbitToken?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const stored = await getSettings();
  const url = (body.bookOrbitUrl ?? stored.bookOrbitUrl ?? "").trim().replace(/\/+$/, "");
  const token = body.bookOrbitToken?.trim() || stored.bookOrbitToken || "";

  if (!url || !token) {
    return fail("BookOrbit URL and token are both required to test the connection.");
  }

  try {
    const client = new BookOrbitClient(url, token);
    const result = await client.testConnection();
    return ok({ ok: true, authorCount: result.authorCount });
  } catch (err) {
    return fail(`Connection failed: ${(err as Error).message}`, 502);
  }
}
