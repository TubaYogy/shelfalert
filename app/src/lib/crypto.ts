import crypto from "crypto";
import { env } from "./env";

/**
 * Symmetric AES-256-GCM encryption used to store the BookOrbit API token at
 * rest in the database. The key is derived from NEXTAUTH_SECRET so no extra
 * secret management is required.
 */

const ALGO = "aes-256-gcm";

function getKey(): Buffer {
  // Derive a stable 32-byte key from the auth secret.
  return crypto.createHash("sha256").update(env.authSecret).digest();
}

export function encrypt(plain: string): string {
  if (!plain) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Store as iv:tag:ciphertext, all base64.
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(payload: string | null | undefined): string {
  if (!payload) return "";
  try {
    const [ivB64, tagB64, dataB64] = payload.split(":");
    if (!ivB64 || !tagB64 || !dataB64) return "";
    const iv = Buffer.from(ivB64, "base64");
    const tag = Buffer.from(tagB64, "base64");
    const data = Buffer.from(dataB64, "base64");
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
}

export function generateToken(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}
