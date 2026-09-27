import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { env } from "./env";

/**
 * Lightweight, self-contained authentication.
 *
 * "Simple to start with" (credentials + session cookie). The design keeps an
 * OIDC upgrade path open via the OIDC_* environment variables (see README).
 *
 * A signed JWT is stored in an httpOnly cookie. Verification happens both in
 * middleware (edge) and in server components / route handlers.
 */

export const SESSION_COOKIE = "shelfalert_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

export interface SessionPayload {
  sub: string; // user id
  username: string;
  role: "USER" | "ADMIN";
  [key: string]: unknown;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(env.authSecret);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload as SessionPayload;
  } catch {
    return null;
  }
}

/**
 * Authenticate a username/password pair against the database.
 * Returns the session payload on success, or null on failure.
 */
export async function authenticate(
  username: string,
  password: string
): Promise<SessionPayload | null> {
  if (!username || !password) return null;
  const user = await prisma.user.findUnique({ where: { username } });
  if (!user) return null;
  const ok = await verifyPassword(password, user.password);
  if (!ok) return null;
  return {
    sub: String(user.id),
    username: user.username,
    role: user.role,
  };
}

/** Persist the session cookie (call from a route handler / server action). */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env.nodeEnv === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

/** Read the current session from the request cookies (server-side). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Ensure an initial admin user + default settings exist. Runs on server boot.
 */
export async function ensureBootstrap(): Promise<void> {
  const userCount = await prisma.user.count();
  if (userCount === 0) {
    const password = env.adminPassword || "admin";
    const hashed = await hashPassword(password);
    await prisma.user.create({
      data: {
        username: env.adminUsername,
        password: hashed,
        role: "ADMIN",
      },
    });
    // eslint-disable-next-line no-console
    console.log(
      `[bootstrap] Created initial admin user "${env.adminUsername}"` +
        (env.adminPassword ? "" : " with default password 'admin' — set ADMIN_PASSWORD!")
    );
  }

  const settings = await prisma.appSettings.findUnique({ where: { id: 1 } });
  if (!settings) {
    const { generateToken } = await import("./crypto");
    await prisma.appSettings.create({
      data: {
        id: 1,
        widgetToken: generateToken(),
      },
    });
    // eslint-disable-next-line no-console
    console.log("[bootstrap] Created default AppSettings row.");
  } else if (!settings.widgetToken) {
    const { generateToken } = await import("./crypto");
    await prisma.appSettings.update({
      where: { id: 1 },
      data: { widgetToken: generateToken() },
    });
  }
}
