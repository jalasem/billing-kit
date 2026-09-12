import { getCurrency } from "./currencies";

/**
 * Formats a bigint amount in minor units (e.g. kobo, cents) as a localized
 * currency string. The conversion to major units goes through `Number`,
 * which is exact for every amount well below `Number.MAX_SAFE_INTEGER`
 * (about 90 trillion naira/dollars at 2 decimal places) — comfortably
 * beyond what a formatter needs to render for a human.
 */
export function format(amount: bigint, currency: string, locale = "en-US"): string {
  const { exponent } = getCurrency(currency);
  const majorUnits = Number(amount) / 10 ** exponent;

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: exponent,
    maximumFractionDigits: exponent,
  }).format(majorUnits);
}
