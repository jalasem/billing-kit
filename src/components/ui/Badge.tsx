export type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/**
 * Every tone pairs a light background with a dark text of the same hue —
 * each pairing measures at or above 4.5:1 contrast — and the label text
 * itself (never colour alone) is what actually communicates status.
 */
const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "bg-slate-100 text-slate-800",
  success: "bg-green-100 text-green-900",
  warning: "bg-amber-100 text-amber-900",
  danger: "bg-red-100 text-red-900",
  info: "bg-blue-100 text-blue-900",
};

export interface BadgeProps {
  tone?: BadgeTone;
  children: React.ReactNode;
  className?: string;
}

export function Badge({ tone = "neutral", children, className = "" }: BadgeProps) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[tone]} ${className}`}>
      {children}
    </span>
  );
}

const SUBSCRIPTION_TONES: Record<string, BadgeTone> = {
  trialing: "info",
  active: "success",
  past_due: "warning",
  unpaid: "danger",
  cancelled: "neutral",
  paused: "neutral",
};

const INVOICE_TONES: Record<string, BadgeTone> = {
  draft: "neutral",
  open: "warning",
  paid: "success",
  void: "neutral",
  uncollectible: "danger",
};

/** Status badge for a subscription status; falls back to `neutral` for any value not in the map. */
export function SubscriptionStatusBadge({ status }: { status: string }) {
  return <Badge tone={SUBSCRIPTION_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}

/** Status badge for an invoice status; falls back to `neutral` for any value not in the map. */
export function InvoiceStatusBadge({ status }: { status: string }) {
  return <Badge tone={INVOICE_TONES[status] ?? "neutral"}>{status.replace(/_/g, " ")}</Badge>;
}
