import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { triggerManualSync } from "@/lib/scheduler";
import { isSyncRunning } from "@/lib/scheduler";

/**
 * POST /api/sync/releases          — refresh release data only (fire-and-forget).
 * POST /api/sync/releases?full=1   — full sync: BookOrbit + releases (fire-and-forget).
 *
 * Returns 202 immediately. Poll GET /api/sync/status for progress.
 * With 1000+ authors the sync takes many minutes — holding the HTTP connection
 * open caused the request to time out and show "Sync failed" even though the
 * scheduler was still running correctly in the background.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  if (isSyncRunning()) {
    return NextResponse.json(
      { running: true, message: "A sync is already in progress." },
      { status: 202 }
    );
  }

  // Fire-and-forget — do NOT await.
  const reason =
    new URL(req.url).searchParams.get("full") === "1"
      ? "manual full sync"
      : "manual release refresh";
  void triggerManualSync(reason);

  return NextResponse.json(
    { running: true, message: "Sync started. It will run in the background." },
    { status: 202 }
  );
}
