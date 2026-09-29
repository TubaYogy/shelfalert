import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { syncBookNotification } from "@/lib/release-sync";
import { parseBookNotificationCsv } from "@/lib/booknotification";

/**
 * Module-level guard preventing overlapping BookNotification imports. The import
 * runs in the background (fire-and-forget) after the request responds, so this
 * flag stops a second upload from kicking off a duplicate concurrent run.
 */
let bnSyncRunning = false;

/**
 * POST /api/sync/booknotification
 * Accepts a multipart/form-data upload with a `file` field containing the CSV
 * exported from booknotification.com (My Library → Download CSV).
 *
 * The multipart body is fully read and parsed synchronously (fast, in-memory),
 * then the actual database import — hundreds of sequential upserts — is fired in
 * the background WITHOUT awaiting it, and the handler returns 202 immediately.
 * Awaiting the import would exceed the HTTP timeout and surface as a browser
 * "Network error". This mirrors the fire-and-forget pattern in
 * /api/sync/releases and /api/sync/bookorbit.
 *
 * The site's LiteSpeed WAF blocks server-side scraping (non-browser TLS
 * fingerprints are redirected before any session cookie is set), so a manual
 * CSV upload is the supported flow.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  // 1) Read the multipart body fully BEFORE responding — Next.js closes the
  //    request stream once a response is sent, so this must happen up front.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { ok: false, message: "Expected a multipart form upload with a CSV file." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json(
      { ok: false, message: "No CSV file provided. Upload your BookNotification CSV export." },
      { status: 400 }
    );
  }

  const csvText = await file.text();
  if (!csvText.trim()) {
    return NextResponse.json(
      { ok: false, message: "The uploaded CSV file is empty." },
      { status: 400 }
    );
  }

  // 2) Parse the CSV in memory (fast).
  let releases;
  try {
    releases = parseBookNotificationCsv(csvText);
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: `Could not parse the CSV: ${(err as Error).message}` },
      { status: 400 }
    );
  }

  if (releases.length === 0) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "No releases could be read from the CSV. Make sure it is the BookNotification export with Book Title, Author, Series and Release Date columns.",
      },
      { status: 400 }
    );
  }

  // 3) Prevent overlapping imports.
  if (bnSyncRunning) {
    return NextResponse.json(
      {
        ok: true,
        message:
          "A BookNotification import is already running. Refresh the page in a moment to see results.",
      },
      { status: 202 }
    );
  }

  // 4) Fire the import in the background WITHOUT awaiting it, then respond 202.
  bnSyncRunning = true;
  void syncBookNotification(releases)
    .catch((err) => {
      console.error("[booknotification] background import failed:", err);
    })
    .finally(() => {
      bnSyncRunning = false;
    });

  return NextResponse.json(
    {
      ok: true,
      message: `Starting import of ${releases.length} releases in the background. Refresh the page in a moment to see results.`,
    },
    { status: 202 }
  );
}
