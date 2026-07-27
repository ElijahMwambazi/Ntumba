import type { PaymentStatus } from "@ntumba/contracts";

const allowedTransitions = {
  created: ["provider_collecting", "direct_payment_pending", "expired", "failed"],
  direct_payment_pending: ["direct_payment_settled", "expired", "failed", "manual_review"],
  direct_payment_settled: [],
  expired: [],
  failed: ["refund_pending", "manual_review"],
  manual_review: ["provider_settling", "refund_pending", "failed", "settled"],
  provider_collecting: [
    "provider_settling",
    "expired",
    "failed",
    "refund_pending",
    "manual_review",
  ],
  provider_settling: ["settled", "failed", "refund_pending", "manual_review"],
  refund_pending: ["refunded", "manual_review"],
  refunded: [],
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
