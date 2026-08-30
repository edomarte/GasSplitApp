import { createHash, randomBytes } from "node:crypto";

/**
 * Invite tokens.
 *
 * The raw token only ever exists in the link we hand out. What is stored, and
 * what travels to the database when someone redeems it, is the SHA-256 hash —
 * so a leaked `invites` table cannot be used to join anything.
 *
 * 32 random bytes is far past guessable, and base64url keeps the link short
 * enough to scan comfortably as a QR code.
 */

export const INVITE_TTL_HOURS = 168; // 7 days

export function createInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function inviteUrl(origin: string, token: string): string {
  return `${origin}/join/${encodeURIComponent(token)}`;
}

export function inviteExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);
}
