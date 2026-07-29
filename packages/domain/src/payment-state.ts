import type { PaymentStatus } from "@ntumba/contracts";

const allowedTransitions = {
  awaiting_source_payment: [
    "source_payment_confirming",
    "source_payment_settled",
    "source_payment_failed",
    "expired",
    "rate_expired",
    "manual_review",
  ],
  created: [
    "quote_locked",
    "direct_payment_pending",
    "liquidity_unavailable",
    "expired",
    "rate_expired",
  ],
  destination_settlement_failed: [
    "destination_settlement_queued",
    "liquidity_unavailable",
    "refund_required",
    "manual_review",
  ],
  destination_settlement_processing: [
    "settled",
    "destination_settlement_failed",
    "refund_required",
    "manual_review",
  ],
  destination_settlement_queued: [
    "destination_settlement_processing",
    "refund_required",
    "manual_review",
  ],
  direct_payment_pending: ["direct_payment_settled", "expired", "manual_review"],
  direct_payment_settled: [],
  expired: [],
  liquidity_unavailable: [],
  manual_review: ["refund_required", "refund_pending", "refunded"],
  quote_locked: [
    "awaiting_source_payment",
    "liquidity_unavailable",
    "source_payment_failed",
    "manual_review",
    "rate_expired",
    "expired",
  ],
  rate_expired: [],
  refund_required: ["refund_pending", "manual_review"],
  refund_pending: ["refunded", "manual_review"],
  refunded: [],
  source_payment_confirming: [
    "source_payment_settled",
    "source_payment_failed",
    "expired",
    "manual_review",
  ],
  source_payment_failed: ["expired", "manual_review"],
  source_payment_settled: ["destination_settlement_queued", "refund_required", "manual_review"],
  settled: [],
} as const satisfies Record<PaymentStatus, readonly PaymentStatus[]>;

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  return (allowedTransitions[from] as readonly PaymentStatus[]).includes(to);
}

export function assertTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Illegal payment transition: ${from} -> ${to}`);
  }
}

export function assertLateSourceSettlementTransition(
  from: PaymentStatus,
  to: "destination_settlement_queued" | "refund_required",
): void {
  const allowed =
    (from === "manual_review" &&
      (to === "destination_settlement_queued" || to === "refund_required")) ||
    ((from === "expired" || from === "source_payment_failed") && to === "refund_required");
  if (!allowed) {
    throw new Error(`Illegal late source settlement transition: ${from} -> ${to}`);
  }
}
