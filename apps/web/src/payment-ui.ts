import type { Asset, PayerMethod, PaymentStatus, SettlementDestination } from "@ntumba/contracts";

export function payerMethodsFor(receiveAsset: Asset): PayerMethod[] {
  return receiveAsset === "ZMW" ? ["BTC"] : ["BTC", "ZMW"];
}

export function maskDestination(destination: SettlementDestination): string {
  if (destination.type === "mobile_money") {
    const digits = destination.phone.replace(/\D/gu, "");
    return `${destination.network.toUpperCase()} ••• ••• ${digits.slice(-4)}`;
  }
  if (destination.type === "lightning_invoice") {
    return `Invoice •••${destination.invoice.slice(-6)}`;
  }
  const [name = "", domain = ""] = destination.address.split("@");
  return `${name.slice(0, 2)}•••@${domain}`;
}

export function isExpired(expiresAt: string, now = Date.now()): boolean {
  return new Date(expiresAt).getTime() <= now;
}

export function formatCountdown(expiresAt: string, now = Date.now()): string {
  const seconds = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 1_000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

export const plainStatus: Record<
  PaymentStatus,
  { detail: string; label: string; tone: "danger" | "neutral" | "success" | "warning" }
> = {
  created: {
    detail: "The request is ready to share.",
    label: "Request created",
    tone: "neutral",
  },
  quote_locked: {
    detail: "The conversion rate and destination liquidity are reserved briefly.",
    label: "Quote locked",
    tone: "neutral",
  },
  awaiting_source_payment: {
    detail: "Complete the source payment to the Ntumba-operated fake bridge.",
    label: "Waiting for payment",
    tone: "neutral",
  },
  source_payment_confirming: {
    detail: "The fake bridge is waiting for conclusive source-payment confirmation.",
    label: "Confirming payment",
    tone: "neutral",
  },
  source_payment_settled: {
    detail: "Source funds are confirmed; destination settlement has not completed yet.",
    label: "Source received",
    tone: "warning",
  },
  destination_settlement_queued: {
    detail: "The fake bridge has queued the merchant settlement leg.",
    label: "Merchant payout queued",
    tone: "neutral",
  },
  destination_settlement_processing: {
    detail: "The fake bridge is processing the merchant settlement leg.",
    label: "Paying merchant",
    tone: "neutral",
  },
  direct_payment_pending: {
    detail: "Ntumba cannot confirm this direct wallet payment yet.",
    label: "Waiting for payment",
    tone: "warning",
  },
  direct_payment_settled: {
    detail: "Independent payment evidence confirmed the merchant received Bitcoin.",
    label: "Payment received",
    tone: "success",
  },
  expired: {
    detail: "Ask the merchant to create a new request.",
    label: "Request expired",
    tone: "warning",
  },
  source_payment_failed: {
    detail: "The source payment conclusively failed and reserved liquidity was released.",
    label: "Source payment failed",
    tone: "danger",
  },
  destination_settlement_failed: {
    detail: "The source settled, but the merchant payout conclusively failed.",
    label: "Merchant payout failed",
    tone: "danger",
  },
  liquidity_unavailable: {
    detail: "The fake bridge could not reserve enough destination liquidity.",
    label: "Liquidity unavailable",
    tone: "danger",
  },
  rate_expired: {
    detail: "The locked conversion rate expired before the payment could proceed.",
    label: "Rate expired",
    tone: "warning",
  },
  manual_review: {
    detail: "Do not pay again until the payment can be checked.",
    label: "Could not confirm payment",
    tone: "warning",
  },
  refund_required: {
    detail: "Source funds settled but the destination cannot be paid; a refund is required.",
    label: "Refund required",
    tone: "danger",
  },
  refund_pending: {
    detail: "The fake bridge is processing the refund obligation.",
    label: "Refund pending",
    tone: "warning",
  },
  refunded: {
    detail: "The fake bridge records the payment as refunded.",
    label: "Refunded",
    tone: "neutral",
  },
  settled: {
    detail: "Both bridge legs are conclusively settled.",
    label: "Merchant paid",
    tone: "success",
  },
};
