import { NextRequest } from "next/server";
import { requireSession, ok, fail } from "@/lib/api";
import { syncReleases, runFullSync } from "@/lib/release-sync";

/**
 * POST /api/sync/releases          — refresh release data only.
 * POST /api/sync/releases?full=1   — run a full sync (BookOrbit + releases).
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const full = new URL(req.url).searchParams.get("full") === "1";

  try {
    const result = full ? await runFullSync() : await syncReleases();
    return ok(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return fail(`Sync failed: ${(err as Error).message}`, 500);
  }
}
