import { z } from "zod";

const zmwAmountPattern = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const zambianPhonePattern = /^(?:\+?260|0)?(?:5|6|7|9)\d{8}$/;

export const paymentDirectionSchema = z.enum(["btc_to_zmw", "zmw_to_btc", "btc_to_btc"]);
export type PaymentDirection = z.infer<typeof paymentDirectionSchema>;

export const paymentStatusSchema = z.enum([
  "created",
  "quote_locked",
  "awaiting_source_payment",
  "source_payment_confirming",
  "source_payment_settled",
  "destination_settlement_queued",
  "destination_settlement_processing",
  "direct_payment_pending",
  "direct_payment_settled",
  "settled",
  "expired",
  "source_payment_failed",
  "destination_settlement_failed",
  "liquidity_unavailable",
  "rate_expired",
  "refund_required",
  "refund_pending",
  "refunded",
  "manual_review",
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const assetSchema = z.enum(["BTC", "ZMW"]);
export type Asset = z.infer<typeof assetSchema>;

export const mobileMoneyNetworkSchema = z.enum(["mtn", "airtel", "zamtel"]);
export type MobileMoneyNetwork = z.infer<typeof mobileMoneyNetworkSchema>;

const amountZmwSchema = z
  .string()
  .regex(zmwAmountPattern, "Enter a valid Kwacha amount with no more than two decimal places.")
  .refine((value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0")) > 0n;
  }, "Amount must be greater than zero.");

const phoneSchema = z
  .string()
  .trim()
  .max(24)
  .regex(zambianPhonePattern, "Enter a valid Zambian mobile number.");

const lightningAddressSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "Enter a valid Lightning address.");

const lightningInvoiceSchema = z
  .string()
  .trim()
  .min(20)
  .max(4_096)
  .regex(/^ln(?:bc|tb|bcrt)[a-z0-9]+$/i, "Enter a valid Lightning invoice.");

export const createQuoteRequestSchema = z.object({
  amountZmw: amountZmwSchema,
  direction: paymentDirectionSchema,
});
export type CreateQuoteRequest = z.infer<typeof createQuoteRequestSchema>;

const displayedAmountSchema = z.object({
  amount: z.string(),
  asset: assetSchema,
  display: z.string(),
});

export const createQuoteResponseSchema = z.object({
  amountZmw: z.string(),
  direction: paymentDirectionSchema,
  exchangeRate: z.string(),
  expiresAt: z.iso.datetime(),
  feeZmw: z.string(),
  merchantReceives: displayedAmountSchema,
  payerSends: displayedAmountSchema,
  quoteId: z.uuid(),
});
export type CreateQuoteResponse = z.infer<typeof createQuoteResponseSchema>;

export const mobileMoneyDestinationSchema = z.object({
  network: mobileMoneyNetworkSchema,
  phone: phoneSchema,
  type: z.literal("mobile_money"),
});

export const lightningAddressDestinationSchema = z.object({
  address: lightningAddressSchema,
  type: z.literal("lightning_address"),
});

export const lightningInvoiceDestinationSchema = z.object({
  invoice: lightningInvoiceSchema,
  type: z.literal("lightning_invoice"),
});

export const settlementDestinationSchema = z.discriminatedUnion("type", [
  mobileMoneyDestinationSchema,
  lightningAddressDestinationSchema,
  lightningInvoiceDestinationSchema,
]);
export type SettlementDestination = z.infer<typeof settlementDestinationSchema>;

const idempotencyKeySchema = z.string().trim().min(16).max(128);

export const createPaymentIntentRequestSchema = z.discriminatedUnion("direction", [
  z.object({
    destination: mobileMoneyDestinationSchema,
    direction: z.literal("btc_to_zmw"),
    idempotencyKey: idempotencyKeySchema,
    quoteId: z.uuid(),
  }),
  z.object({
    destination: z.discriminatedUnion("type", [
      lightningAddressDestinationSchema,
      lightningInvoiceDestinationSchema,
    ]),
    direction: z.literal("zmw_to_btc"),
    idempotencyKey: idempotencyKeySchema,
    quoteId: z.uuid(),
  }),
  z.object({
    destination: z.discriminatedUnion("type", [
      lightningAddressDestinationSchema,
      lightningInvoiceDestinationSchema,
    ]),
    direction: z.literal("btc_to_btc"),
    idempotencyKey: idempotencyKeySchema,
    quoteId: z.uuid(),
  }),
]);
export type CreatePaymentIntentRequest = z.infer<typeof createPaymentIntentRequestSchema>;

const providerCheckoutSchema = z.object({
  checkoutUrl: z.url(),
  instructions: z.string(),
  providerReference: z.string(),
  type: z.literal("provider"),
});

const directCheckoutSchema = z.object({
  merchantOwned: z.literal(true),
  paymentRequest: lightningInvoiceSchema,
  type: z.literal("direct_lightning"),
  verification: z.literal("unverified"),
});

export const checkoutInstructionsSchema = z.discriminatedUnion("type", [
  providerCheckoutSchema,
  directCheckoutSchema,
]);
export type CheckoutInstructions = z.infer<typeof checkoutInstructionsSchema>;

export const paymentIntentResponseSchema = z.object({
  checkout: checkoutInstructionsSchema,
  direction: paymentDirectionSchema,
  expiresAt: z.iso.datetime(),
  paymentIntentId: z.uuid(),
  quote: createQuoteResponseSchema,
  status: paymentStatusSchema,
});
export type PaymentIntentResponse = z.infer<typeof paymentIntentResponseSchema>;

export const paymentIntentStatusResponseSchema = z.object({
  direction: paymentDirectionSchema,
  expiresAt: z.iso.datetime(),
  failureCode: z.string().nullable(),
  paymentIntentId: z.uuid(),
  status: paymentStatusSchema,
  updatedAt: z.iso.datetime(),
});
export type PaymentIntentStatusResponse = z.infer<typeof paymentIntentStatusResponseSchema>;

export const payerMethodSchema = z.enum(["BTC", "ZMW"]);
export type PayerMethod = z.infer<typeof payerMethodSchema>;

export const publicRequestOptionSchema = z.object({
  intent: paymentIntentResponseSchema,
  payerMethod: payerMethodSchema,
});
export type PublicRequestOption = z.infer<typeof publicRequestOptionSchema>;

export const createPublicRequestRequestSchema = z.object({
  amountZmw: amountZmwSchema,
  idempotencyKey: idempotencyKeySchema,
  merchantLabel: z.string().trim().min(1).max(80).optional(),
  options: z.array(publicRequestOptionSchema).min(1).max(2),
  receiveAsset: assetSchema,
  reference: z.string().trim().min(1).max(120).optional(),
});
export type CreatePublicRequestRequest = z.infer<typeof createPublicRequestRequestSchema>;

export const publicPaymentRequestSchema = z.object({
  amountZmw: z.string(),
  createdAt: z.iso.datetime(),
  developmentOnly: z.literal(true),
  expiresAt: z.iso.datetime(),
  merchantLabel: z.string().nullable(),
  options: z.array(publicRequestOptionSchema).min(1).max(2),
  publicId: z.uuid(),
  receiveAsset: assetSchema,
  reference: z.string().nullable(),
});
export type PublicPaymentRequest = z.infer<typeof publicPaymentRequestSchema>;

export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
  }),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
