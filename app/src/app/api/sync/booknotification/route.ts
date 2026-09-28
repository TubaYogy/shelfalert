import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/api";
import { syncBookNotification } from "@/lib/release-sync";
import { parseBookNotificationCsv } from "@/lib/booknotification";

/**
 * POST /api/sync/booknotification
 * Accepts a multipart/form-data upload with a `file` field containing the CSV
 * exported from booknotification.com (My Library → Download CSV). Parses the
 * CSV, imports releases for tracked authors, and flags matched authors as
 * present on BookNotification.
 *
 * The site's LiteSpeed WAF blocks server-side scraping (non-browser TLS
 * fingerprints are redirected before any session cookie is set), so a manual
 * CSV upload is the supported flow.
 */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

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

  try {
    const result = await syncBookNotification(releases);
    return NextResponse.json(result, { status: result.ok ? 200 : 502 });
  } catch (err) {
    return NextResponse.json(
      { ok: false, message: (err as Error).message },
      { status: 500 }
    );
  }
}
