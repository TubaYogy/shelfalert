import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "shelfalert_session";

function secretKey(): Uint8Array {
  const secret =
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "shelfalert-insecure-dev-secret-change-me";
  return new TextEncoder().encode(secret);
}

async function isAuthed(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secretKey());
    return true;
  } catch {
    return false;
  }
}

/**
 * Protects app pages and mutating API routes. Public:
 *   - /login
 *   - /widget  (embeddable, uses its own widget token)
 *   - /api/auth/*  (login/logout)
 *   - /api/widget/*  (token-guarded JSON for Homarr)
 *   - static assets
 */
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic =
    pathname === "/login" ||
    pathname === "/widget" ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/widget");

  if (isPublic) {
    return NextResponse.next();
  }

  const authed = await isAuthed(req);

  // Protect API routes -> 401 JSON.
  if (pathname.startsWith("/api/")) {
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Protect pages -> redirect to /login.
  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except Next internals and static files.
     */
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webp)).*)",
  ],
};
