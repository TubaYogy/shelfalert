import { NextRequest, NextResponse } from "next/server";
import {
  authenticate,
  createSessionToken,
  setSessionCookie,
  clearSessionCookie,
  getSession,
} from "@/lib/auth";

/**
 * Catch-all auth endpoint (kept at the conventional /api/auth/* path so a
 * future migration to NextAuth/OIDC is a drop-in replacement).
 *
 *   POST /api/auth/login   { username, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/session
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await ctx.params;
  const action = nextauth?.[0];

  if (action === "login") {
    let body: { username?: string; password?: string };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }
    const session = await authenticate(body.username ?? "", body.password ?? "");
    if (!session) {
      return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
    }
    const token = await createSessionToken(session);
    await setSessionCookie(token);
    return NextResponse.json({ ok: true, user: { username: session.username, role: session.role } });
  }

  if (action === "logout") {
    await clearSessionCookie();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ nextauth: string[] }> }) {
  const { nextauth } = await ctx.params;
  const action = nextauth?.[0];

  if (action === "session") {
    const session = await getSession();
    if (!session) return NextResponse.json({ authenticated: false });
    return NextResponse.json({
      authenticated: true,
      user: { username: session.username, role: session.role },
    });
  }

  return NextResponse.json({ error: "Not found" }, { status: 404 });
}
