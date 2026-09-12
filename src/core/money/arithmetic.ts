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
