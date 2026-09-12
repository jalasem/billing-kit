import { format } from "@/core/money/format";

export interface MoneyProps {
  /** Minor units. */
  amount: bigint;
  currency: string;
  className?: string;
}

/** Renders a minor-unit amount through the canonical `format()` helper — never a raw division in a component. */
export function Money({ amount, currency, className }: MoneyProps) {
  return <span className={className}>{format(amount, currency)}</span>;
}
