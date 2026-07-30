import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  type CheckoutInstructions,
  type CreatePaymentIntentRequest,
  createPaymentIntentRequestSchema,
  type PaymentIntentResponse,
  paymentIntentResponseSchema,
  paymentIntentStatusResponseSchema,
} from "@ntumba/contracts";
import { createRetentionWindow } from "@ntumba/domain";
import type { NtumbaMetrics } from "@ntumba/observability";
import type { DirectLightningProvider } from "@ntumba/providers";
import type { BridgeEngine } from "@ntumba/treasury";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { purgeWithMetrics } from "../observability.js";
import type { PaymentStore, StoredPaymentIntent } from "../payment-store.js";

export interface PaymentRouteDependencies {
  bridgeEngine: BridgeEngine;
  directLightningProvider: DirectLightningProvider;
  metrics?: NtumbaMetrics | undefined;
  store: PaymentStore;
}

type BridgePaymentIntentRequest = Exclude<CreatePaymentIntentRequest, { direction: "btc_to_btc" }>;

async function dispatchProviderIntent(
  config: NtumbaConfig,
  dependencies: PaymentRouteDependencies,
  input: BridgePaymentIntentRequest,
  stagedIntent: StoredPaymentIntent,
  quote: NonNullable<Awaited<ReturnType<PaymentStore["getQuote"]>>>,
): Promise<{ checkout: CheckoutInstructions; intent: StoredPaymentIntent }> {
  if (config.BRIDGE_ENGINE_MODE !== "fake") {
    throw new Error("The conversion bridge is disabled.");
  }
  const sourceAmount =
    input.direction === "btc_to_zmw" ? quote.payerAmountSats : quote.payerAmountZmwMinor;
  const destinationAmount =
    input.direction === "btc_to_zmw" ? quote.merchantAmountZmwMinor : quote.merchantAmountSats;
  if (sourceAmount === null || destinationAmount === null) {
    throw new Error("The bridge quote has incomplete integer leg amounts.");
  }
  let bridge: Awaited<ReturnType<BridgeEngine["create"]>>;
  try {
    bridge = await dependencies.bridgeEngine.create({
      collectionIdempotencyKey: `collection:${input.idempotencyKey}`,
      destination: input.destination,
      destinationAmount,
      destinationAsset: input.direction === "btc_to_zmw" ? "ZMW" : "BTC",
      direction: input.direction,
      destinationExpiresAt: new Date(
        stagedIntent.createdAt.getTime() + config.SETTLEMENT_DESTINATION_TTL_SECONDS * 1_000,
      ),
      settlementIdempotencyKey: `settlement:${input.idempotencyKey}`,
      sourceAmount,
      sourceAsset: input.direction === "btc_to_zmw" ? "BTC" : "ZMW",
      sourcePaymentExpiresAt: new Date(
        stagedIntent.createdAt.getTime() + config.SOURCE_PAYMENT_TTL_SECONDS * 1_000,
      ),
      intent: {
        createdAt: stagedIntent.createdAt,
        destinationAmount,
        destinationAsset: input.direction === "btc_to_zmw" ? "ZMW" : "BTC",
        direction: input.direction,
        expiresAt: stagedIntent.expiresAt,
        id: stagedIntent.id,
        idempotencyKey: stagedIntent.idempotencyKey,
        provider: "fake_treasury",
        purgeAt: stagedIntent.purgeAt,
        quoteId: stagedIntent.quoteId,
        sourceAmount,
        sourceAsset: input.direction === "btc_to_zmw" ? "BTC" : "ZMW",
      },
    });
  } catch (error) {
    await dependencies.store.recordProviderIntentFailure(
      stagedIntent.id,
      "PROVIDER_REQUEST_FAILED",
      new Date(),
    );
    throw error;
  }

  const completedView: StoredPaymentIntent = {
    ...stagedIntent,
    destinationToken: bridge.destinationLookupToken,
    expiresAt: bridge.expiresAt,
    failureCode: bridge.settlement.failureCode,
    providerReference: bridge.sourceReference,
    updatedAt: new Date(),
    status: bridge.settlement.status,
  };
  const intent = await dependencies.store.saveIntent(completedView);
  if (
    intent.providerReference !== bridge.sourceReference ||
    intent.destinationToken !== bridge.destinationLookupToken
  ) {
    throw new Error("Bridge idempotency returned a conflicting source leg.");
  }

  return {
    checkout: {
      checkoutUrl: bridge.checkoutUrl,
      instructions: bridge.payerInstructions,
      providerReference: bridge.sourceReference,
      type: "provider",
    },
    intent,
  };
}

interface PaymentIntentErrors {
  badRequest(message: string): Error;
  conflict(message: string): Error;
  gone(message: string): Error;
  serviceUnavailable(message: string): Error;
}

function providerCheckoutFor(intent: StoredPaymentIntent): CheckoutInstructions | undefined {
  if (intent.direction === "btc_to_btc" || !intent.providerReference) {
    return undefined;
  }
  return {
    checkoutUrl:
      intent.direction === "btc_to_zmw"
        ? `https://treasury.invalid/lightning/${intent.providerReference}`
        : "https://treasury.invalid/mobile-money",
    instructions:
      intent.direction === "btc_to_zmw"
        ? "Pay the simulated operator Lightning invoice."
        : "Approve the simulated Lipila mobile-money collection.",
    providerReference: intent.providerReference,
    type: "provider",
  };
}

export async function resumeDurableProviderIntent(
  dependencies: PaymentRouteDependencies,
  paymentIntentId: string,
  quoteId: string,
): Promise<PaymentIntentResponse | undefined> {
  const [intent, quote] = await Promise.all([
    dependencies.store.getIntent(paymentIntentId),
    dependencies.store.getQuote(quoteId),
  ]);
  const checkout = intent ? providerCheckoutFor(intent) : undefined;
  if (!intent || !quote || intent.quoteId !== quoteId || !checkout) {
    return undefined;
  }
  return {
    checkout,
    direction: intent.direction,
    expiresAt: intent.expiresAt.toISOString(),
    paymentIntentId: intent.id,
    quote: quote.response,
    status: intent.status,
  };
}

export async function createPaymentIntentForRequest(
  config: NtumbaConfig,
  dependencies: PaymentRouteDependencies,
  input: CreatePaymentIntentRequest,
  errors: PaymentIntentErrors,
  now = new Date(),
  allocatedPaymentIntentId?: string,
) {
  await purgeWithMetrics(dependencies.store, dependencies.metrics, "opportunistic", now);
  const quote = await dependencies.store.getQuote(input.quoteId);
  if (!quote) {
    throw errors.gone("The quote has expired. Create a new quote.");
  }
  if (quote.response.direction !== input.direction) {
    throw errors.badRequest("The payment direction does not match the quote.");
  }
  if (input.direction !== "btc_to_btc" && config.BRIDGE_ENGINE_MODE !== "fake") {
    throw errors.serviceUnavailable(
      "The fake conversion bridge is disabled. Direct Bitcoin remains available.",
    );
  }

  const existing = await dependencies.store.findIntentByIdempotencyKey(input.idempotencyKey);
  if (existing && allocatedPaymentIntentId && existing.id !== allocatedPaymentIntentId) {
    throw errors.conflict("The durable claim is bound to another payment intent.");
  }
  if (
    !existing &&
    !allocatedPaymentIntentId &&
    new Date(quote.response.expiresAt).getTime() <= now.getTime()
  ) {
    throw errors.gone("The quote has expired. Create a new quote.");
  }
  if (existing && (existing.quoteId !== input.quoteId || existing.direction !== input.direction)) {
    throw errors.conflict("The idempotency key is already bound to another payment request.");
  }

  const paymentIntentId = existing?.id ?? allocatedPaymentIntentId ?? randomUUID();
  const retention = createRetentionWindow(
    now,
    config.QUOTE_TTL_SECONDS,
    config.INTENT_RETENTION_SECONDS,
  );
  let intent: StoredPaymentIntent =
    existing ??
    ({
      createdAt: now,
      destinationToken: null,
      direction: input.direction,
      expiresAt: new Date(quote.response.expiresAt),
      failureCode: null,
      id: paymentIntentId,
      idempotencyKey: input.idempotencyKey,
      provider: input.direction === "btc_to_btc" ? null : "fake_treasury",
      providerReference: null,
      purgeAt: retention.purgeAt,
      quoteId: quote.response.quoteId,
      status: "quote_locked",
      updatedAt: now,
    } satisfies StoredPaymentIntent);
  let checkout: CheckoutInstructions;

  if (input.direction === "btc_to_btc") {
    if (quote.merchantAmountSats === null) {
      throw new Error("Direct quote did not include a satoshi amount.");
    }
    if (!existing) {
      intent = await dependencies.store.saveIntent(intent);
      if (intent.id !== paymentIntentId) {
        throw errors.conflict("The idempotency key is already bound to another payment request.");
      }
    }
    const directInvoice = await dependencies.directLightningProvider.prepareMerchantInvoice({
      amountSats: quote.merchantAmountSats,
      destination: input.destination,
      paymentReference: paymentIntentId,
    });
    if (intent.providerReference && intent.providerReference !== directInvoice.paymentHash) {
      throw errors.conflict("Direct invoice recovery returned a conflicting payment reference.");
    }
    intent = await dependencies.store.completeDirectIntent(intent.id, {
      expiresAt: directInvoice.expiresAt,
      providerReference: directInvoice.paymentHash,
      updatedAt: new Date(),
    });
    checkout = {
      merchantOwned: true,
      paymentRequest: directInvoice.paymentRequest,
      type: "direct_lightning",
      verification: "unverified",
    };
  } else {
    if (existing?.providerReference) {
      const resumedCheckout = providerCheckoutFor(existing);
      if (!resumedCheckout) {
        throw new Error("A conversion intent has no recoverable provider checkout.");
      }
      checkout = resumedCheckout;
    } else {
      if (existing && existing.status !== "quote_locked") {
        throw errors.conflict(
          "The source setup outcome requires review and this request remains claimed.",
        );
      }
      const dispatched = await dispatchProviderIntent(config, dependencies, input, intent, quote);
      checkout = dispatched.checkout;
      intent = dispatched.intent;
    }
  }
  if (intent.quoteId !== input.quoteId || intent.direction !== input.direction) {
    throw errors.conflict("The idempotency key is already bound to another payment request.");
  }
  return {
    checkout,
    direction: intent.direction,
    expiresAt: intent.expiresAt.toISOString(),
    paymentIntentId: intent.id,
    quote: quote.response,
    status: intent.status,
  };
}

export function paymentIntentRoutes(
  config: NtumbaConfig,
  dependencies: PaymentRouteDependencies,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/payment-intents",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          body: createPaymentIntentRequestSchema,
          response: { 201: paymentIntentResponseSchema },
          tags: ["Payments"],
        },
      },
      async (request, reply) => {
        const response = await createPaymentIntentForRequest(
          config,
          dependencies,
          request.body,
          app.httpErrors,
        );
        return reply.status(201).send(response);
      },
    );

    app.get(
      "/payment-intents/:id",
      {
        schema: {
          params: z.object({ id: z.uuid() }),
          response: { 200: paymentIntentStatusResponseSchema },
          tags: ["Payments"],
        },
      },
      async (request) => {
        await purgeWithMetrics(
          dependencies.store,
          dependencies.metrics,
          "opportunistic",
          new Date(),
        );
        const intent = await dependencies.store.getIntent(request.params.id);
        if (!intent) {
          throw app.httpErrors.notFound("Payment request not found or no longer retained.");
        }

        return {
          direction: intent.direction,
          expiresAt: intent.expiresAt.toISOString(),
          failureCode: intent.failureCode,
          paymentIntentId: intent.id,
          status: intent.status,
          updatedAt: intent.updatedAt.toISOString(),
        };
      },
    );
  };
}
