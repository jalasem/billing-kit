export interface CurrencyDefinition {
  code: string;
  /** Number of decimal digits in the minor unit, e.g. 2 for cents/kobo. */
  exponent: number;
}

export const CURRENCIES = {
  NGN: { code: "NGN", exponent: 2 },
  USD: { code: "USD", exponent: 2 },
  GBP: { code: "GBP", exponent: 2 },
  EUR: { code: "EUR", exponent: 2 },
} as const satisfies Record<string, CurrencyDefinition>;

export type CurrencyCode = keyof typeof CURRENCIES;

export function isKnownCurrency(code: string): code is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, code);
}

export function getCurrency(code: string): CurrencyDefinition {
  const normalized = code.toUpperCase();
  if (!isKnownCurrency(normalized)) {
    throw new Error(`Unknown currency: ${code}`);
  }
  return CURRENCIES[normalized];
}
