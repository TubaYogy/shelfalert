import { NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { triggerManualSync, isSyncRunning } from "@/lib/scheduler";

/** POST /api/sync/bookorbit — fire-and-forget author sync. Returns 202 immediately. */
export async function POST() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  if (isSyncRunning()) {
    return NextResponse.json(
      { running: true, message: "A sync is already in progress." },
      { status: 202 }
    );
  }

  void triggerManualSync("manual author sync");

  return NextResponse.json(
    { running: true, message: "Author sync started. It will run in the background." },
    { status: 202 }
  );
}
