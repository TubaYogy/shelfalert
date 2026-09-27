import { requireSession, ok, fail } from "@/lib/api";
import { syncAuthorsFromBookOrbit } from "@/lib/release-sync";

/** POST /api/sync/bookorbit — pull authors (+ series gaps) from BookOrbit. */
export async function POST() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  try {
    const result = await syncAuthorsFromBookOrbit();
    return ok(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return fail(`Sync failed: ${(err as Error).message}`, 500);
  }
}
