import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { isSyncRunning } from "@/lib/scheduler";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/sync/status
 * Returns the current sync state so the UI can poll while the background
 * sync is running (fire-and-forget syncs return 202 immediately).
 */
export async function GET() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const settings = await prisma.appSettings.findUnique({
    where: { id: 1 },
    select: { lastReleaseSync: true, lastBookOrbitSync: true, lastSyncStatus: true },
  });

  return NextResponse.json({
    running: isSyncRunning(),
    lastReleaseSync: settings?.lastReleaseSync ?? null,
    lastBookOrbitSync: settings?.lastBookOrbitSync ?? null,
    lastSyncStatus: settings?.lastSyncStatus ?? null,
  });
}
