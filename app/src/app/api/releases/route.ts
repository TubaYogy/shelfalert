import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, ok } from "@/lib/api";
import type { Prisma, ReleaseStatus } from "@prisma/client";

/**
 * GET /api/releases
 *   ?status=UPCOMING|RECENT|MISSING
 *   ?authorId=123
 *   ?limit=100
 * Returns releases + grouped series gaps.
 */
export async function GET(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") as ReleaseStatus | null;
  const authorIdParam = searchParams.get("authorId");
  const limit = Math.min(Number(searchParams.get("limit") ?? "500"), 1000);

  const where: Prisma.ReleaseWhereInput = {};
  if (status && ["UPCOMING", "RECENT", "MISSING"].includes(status)) {
    where.status = status;
  }
  if (authorIdParam && !Number.isNaN(Number(authorIdParam))) {
    where.authorId = Number(authorIdParam);
  }

  const releases = await prisma.release.findMany({
    where,
    orderBy: [{ publishDate: "asc" }],
    take: limit,
    include: { author: { select: { id: true, name: true, photoUrl: true } } },
  });

  const [upcoming, recent, missing] = await Promise.all([
    prisma.release.count({ where: { status: "UPCOMING" } }),
    prisma.release.count({ where: { status: "RECENT" } }),
    prisma.release.count({ where: { status: "MISSING" } }),
  ]);

  const seriesGaps = await prisma.seriesGap.findMany({
    orderBy: [{ seriesName: "asc" }, { missingNumber: "asc" }],
  });

  return ok({
    releases,
    counts: { upcoming, recent, missing, total: upcoming + recent + missing },
    seriesGaps,
  });
}
