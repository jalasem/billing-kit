export function add(a: bigint, b: bigint): bigint {
  return a + b;
}

export function subtract(a: bigint, b: bigint): bigint {
  return a - b;
}

export function negate(a: bigint): bigint {
  return -a;
}

export function sum(amounts: bigint[]): bigint {
  return amounts.reduce((total, amount) => total + amount, 0n);
}

export function assertSameCurrency(currencies: string[]): void {
  const unique = new Set(currencies.map((currency) => currency.toUpperCase()));
  if (unique.size > 1) {
    throw new Error(`Currency mismatch: ${[...unique].join(", ")}`);
  }
}

/**
 * Converts a minor-units `bigint` to a `number` for provider SDKs/APIs that
 * take a JS number, guarding against silent precision loss: a value beyond
 * `Number.MAX_SAFE_INTEGER` would round to the wrong amount instead of
 * throwing if this check were skipped.
 */
export function toSafeNumber(amount: bigint): number {
  const value = Number(amount);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`Amount ${amount.toString()} exceeds Number.MAX_SAFE_INTEGER; cannot pass it to a number-typed API`);
  }
  return value;
}
