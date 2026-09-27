import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, ok, fail } from "@/lib/api";

/** GET /api/authors — list all tracked authors with release counts. */
export async function GET() {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const authors = await prisma.author.findMany({
    orderBy: [{ isActive: "desc" }, { sortName: "asc" }, { name: "asc" }],
    include: {
      _count: { select: { releases: true } },
      releases: {
        where: { status: "UPCOMING" },
        select: { id: true },
      },
    },
  });

  return ok(
    authors.map((a) => ({
      id: a.id,
      name: a.name,
      sortName: a.sortName,
      photoUrl: a.photoUrl,
      bookOrbitId: a.bookOrbitId,
      isActive: a.isActive,
      source: a.source,
      totalReleases: a._count.releases,
      upcomingReleases: a.releases.length,
    }))
  );
}

/** POST /api/authors — manually add an author by name. */
export async function POST(req: NextRequest) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }
  const name = body.name?.trim();
  if (!name) return fail("Author name is required");

  const existing = await prisma.author.findFirst({ where: { name } });
  if (existing) return fail("An author with that name already exists", 409);

  const author = await prisma.author.create({
    data: { name, sortName: name, source: "manual" },
  });
  return ok(author, { status: 201 });
}
