import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession, ok, fail } from "@/lib/api";

/** PATCH /api/authors/:id — toggle active / update fields. */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const authorId = Number(id);
  if (Number.isNaN(authorId)) return fail("Invalid author id");

  let body: { isActive?: boolean; name?: string };
  try {
    body = await req.json();
  } catch {
    return fail("Invalid request body");
  }

  const data: Record<string, unknown> = {};
  if (typeof body.isActive === "boolean") data.isActive = body.isActive;
  if (typeof body.name === "string" && body.name.trim()) data.name = body.name.trim();

  if (Object.keys(data).length === 0) return fail("Nothing to update");

  try {
    const author = await prisma.author.update({ where: { id: authorId }, data });
    return ok(author);
  } catch {
    return fail("Author not found", 404);
  }
}

/** DELETE /api/authors/:id — remove author + their releases (cascade). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireSession();
  if ("response" in guard) return guard.response;

  const { id } = await ctx.params;
  const authorId = Number(id);
  if (Number.isNaN(authorId)) return fail("Invalid author id");

  try {
    await prisma.author.delete({ where: { id: authorId } });
    return ok({ ok: true });
  } catch {
    return fail("Author not found", 404);
  }
}
