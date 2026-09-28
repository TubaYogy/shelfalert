import { NextRequest } from "next/server";
import { requireSession, ok, fail } from "@/lib/api";
import { getSettings } from "@/lib/settings";
import { testHardcoverToken } from "@/lib/hardcover";

/**
 * POST /api/settings/hardcover-test — verify a Hardcover API token.
 * Body: { hardcoverApiKey? } — falls back to the stored token.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: { hardcoverApiKey?: string };
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const stored = await getSettings();
  const token = (body.hardcoverApiKey || stored.hardcoverApiKey || "").trim();

  if (!token) {
    return fail("A Hardcover API token is required to test the connection.");
  }

  try {
    const username = await testHardcoverToken(token);
    return ok({ ok: true, username });
  } catch (err) {
    return fail(`Connection failed: ${(err as Error).message}`, 502);
  }
}
