import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { syncBookNotification } from "@/lib/release-sync";

/**
 * POST /api/sync/booknotification
 * Scrapes the BookNotification.com calendar and imports releases for tracked
 * authors. Runs synchronously — it is a single authenticated page fetch, so it
 * completes quickly (unlike the multi-author full sync).
 */
export async function POST() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  try {
    const result = await syncBookNotification();
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: (err as Error).message },
      { status: 500 }
    );
  }
}
