import { createHash, randomBytes } from "node:crypto";

export interface GeneratedToken {
  /** The raw token — only ever placed in a link or a `Notifier` payload, never stored. */
  token: string;
  /** SHA-256 hex digest of `token`, stored in `magic_links.token_hash`. */
  hash: string;
}

/** 32 random bytes, base64url-encoded, hashed with SHA-256 for storage. */
export function generateToken(): GeneratedToken {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
