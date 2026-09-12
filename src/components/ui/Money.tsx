import { format } from "@/core/money/format";

export interface MoneyProps {
  /** Minor units. */
  amount: bigint;
  currency: string;
  className?: string;
  /** Optional tooltip — e.g. the raw signed ledger balance, when `amount` shown is flipped to its natural-balance direction. */
  title?: string;
}

/** Renders a minor-unit amount through the canonical `format()` helper — never a raw division in a component. */
export function Money({ amount, currency, className, title }: MoneyProps) {
  return (
    <span className={className} title={title}>
      {format(amount, currency)}
    </span>
  );
}
