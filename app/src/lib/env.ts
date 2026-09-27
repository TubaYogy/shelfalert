/**
 * Centralised environment variable access with sensible defaults.
 */

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  databaseUrl: process.env.DATABASE_URL ?? "",
  authSecret:
    process.env.NEXTAUTH_SECRET ??
    process.env.AUTH_SECRET ??
    "shelfalert-insecure-dev-secret-change-me",
  authUrl: process.env.NEXTAUTH_URL ?? "http://localhost:3001",
  adminUsername: process.env.ADMIN_USERNAME ?? "admin",
  adminPassword: process.env.ADMIN_PASSWORD ?? "",
  port: parseInt(process.env.PORT ?? "3000", 10),

  // Optional OIDC (Authelia / Authentik) — enables SSO when all three are set.
  oidc: {
    clientId: process.env.OIDC_CLIENT_ID ?? "",
    clientSecret: process.env.OIDC_CLIENT_SECRET ?? "",
    issuer: process.env.OIDC_ISSUER ?? "",
  },
};

export function isOidcEnabled(): boolean {
  return Boolean(env.oidc.clientId && env.oidc.clientSecret && env.oidc.issuer);
}
