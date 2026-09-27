import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import { daysBetween } from "@/lib/utils";

/**
 * GET /api/widget/upcoming?token=<widgetToken>&limit=5
 *
 * Public (token-guarded) JSON endpoint for the Homarr V2 custom widget.
 * CORS-enabled so Homarr can fetch it cross-origin.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "5"), 1), 25);

  const settings = await getSettings();
  if (!settings.widgetToken || token !== settings.widgetToken) {
    return corsJson({ error: "Invalid or missing widget token" }, 401);
  }

  const now = new Date();

  const upcomingRows = await prisma.release.findMany({
    where: { status: "UPCOMING", publishDate: { gte: now } },
    orderBy: { publishDate: "asc" },
    take: limit,
    include: { author: { select: { name: true } } },
  });

  const [missing, total] = await Promise.all([
    prisma.release.count({ where: { status: "MISSING" } }),
    prisma.release.count(),
  ]);

  const upcoming = upcomingRows.map((r) => ({
    title: r.title,
    author: r.author.name,
    publishDate: r.publishDate ? r.publishDate.toISOString().slice(0, 10) : null,
    coverUrl: r.coverUrl,
    status: r.status,
    daysUntil: r.publishDate ? Math.max(0, daysBetween(now, r.publishDate)) : null,
    seriesName: r.seriesName,
    seriesNumber: r.seriesNumber,
  }));

  return corsJson({
    upcoming,
    missing,
    total,
    lastSync: settings.lastReleaseSync ? settings.lastReleaseSync.toISOString() : null,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300",
  };
}

function corsJson(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status, headers: corsHeaders() });
}
