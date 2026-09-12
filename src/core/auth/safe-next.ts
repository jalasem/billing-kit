/**
 * Accepts `value` as a post-login/redirect target only if it is
 * unambiguously a same-origin relative path: a single leading `/` (not
 * `//`, which a browser treats as protocol-relative), no backslash
 * anywhere (a leading `\` is normalized to `/` by URL parsers, so
 * `/\evil.com` is the same open-redirect shape as `//evil.com` in
 * disguise), and — the belt-and-braces check — resolving it against a
 * placeholder base must not change the origin (catches anything the first
 * two checks don't: an absolute URL, a `javascript:`/other scheme, etc.).
 *
 * Used by the login form (`next` hidden field), the magic-link callback
 * URL builder, and `/auth/callback`'s redirect target — one implementation
 * so the three can't drift out of sync.
 */
export function safeNext(value: string | null | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  if (!value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }
  if (value.includes("\\")) {
    return undefined;
  }

  const PLACEHOLDER_ORIGIN = "http://placeholder.invalid";
  try {
    if (new URL(value, PLACEHOLDER_ORIGIN).origin !== PLACEHOLDER_ORIGIN) {
      return undefined;
    }
  } catch {
    return undefined;
  }

  return value;
}
