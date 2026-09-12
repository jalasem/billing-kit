import { timingSafeEqual } from "node:crypto";

/**
 * Checks `Authorization: Bearer ${CRON_SECRET}` with a constant-time
 * comparison. `timingSafeEqual` throws if the two buffers differ in length,
 * so the length check comes first — a length mismatch is itself a
 * definitive "no match" and must not throw.
 */
export function isAuthorizedCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return false;
  }

  const provided = request.headers.get("authorization");
  if (!provided) {
    return false;
  }

  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(provided);

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
