import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  type CheckoutInstructions,
  type CreatePaymentIntentRequest,
  createPaymentIntentRequestSchema,
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
        await purgeWithMetrics(
          dependencies.store,
          dependencies.metrics,
          "opportunistic",
          new Date(),
        );
        const quote = await dependencies.store.getQuote(request.body.quoteId);
        if (!quote) {
          throw app.httpErrors.gone("The quote has expired. Create a new quote.");
        }
        if (quote.response.direction !== request.body.direction) {
          throw app.httpErrors.badRequest("The payment direction does not match the quote.");
        }
        if (request.body.direction !== "btc_to_btc" && config.BRIDGE_ENGINE_MODE !== "fake") {
          throw app.httpErrors.serviceUnavailable(
            "The fake conversion bridge is disabled. Direct Bitcoin remains available.",
          );
        }

        const existing = await dependencies.store.findIntentByIdempotencyKey(
          request.body.idempotencyKey,
        );
        if (!existing && new Date(quote.response.expiresAt).getTime() <= Date.now()) {
          throw app.httpErrors.gone("The quote has expired. Create a new quote.");
        }
        if (existing) {
          if (
            existing.quoteId !== request.body.quoteId ||
            existing.direction !== request.body.direction
          ) {
            throw app.httpErrors.conflict(
              "The idempotency key is already bound to another payment request.",
            );
          }
          let checkout: CheckoutInstructions;
          let intent = existing;
          if (request.body.direction === "btc_to_btc") {
            if (quote.merchantAmountSats === null) {
              throw new Error("Direct quote did not include a satoshi amount.");
            }
            const directInvoice = await dependencies.directLightningProvider.prepareMerchantInvoice(
              {
                amountSats: quote.merchantAmountSats,
                destination: request.body.destination,
                paymentReference: existing.id,
              },
            );
            checkout = {
              merchantOwned: true,
              paymentRequest: directInvoice.paymentRequest,
              type: "direct_lightning",
              verification: "unverified",
            };
          } else {
            const dispatched = await dispatchProviderIntent(
              config,
              dependencies,
              request.body,
              intent,
              quote,
            );
            checkout = dispatched.checkout;
            intent = dispatched.intent;
          }
          return reply.status(201).send({
            checkout,
            direction: intent.direction,
            expiresAt: intent.expiresAt.toISOString(),
            paymentIntentId: intent.id,
            quote: quote.response,
            status: intent.status,
          });
        }

        const now = new Date();
        const paymentIntentId = randomUUID();
        const retention = createRetentionWindow(
          now,
          config.QUOTE_TTL_SECONDS,
          config.INTENT_RETENTION_SECONDS,
        );
        let intent: StoredPaymentIntent;
        let checkout: CheckoutInstructions;

        if (request.body.direction === "btc_to_btc") {
          if (quote.merchantAmountSats === null) {
            throw new Error("Direct quote did not include a satoshi amount.");
          }
          const directInvoice = await dependencies.directLightningProvider.prepareMerchantInvoice({
            amountSats: quote.merchantAmountSats,
            destination: request.body.destination,
            paymentReference: paymentIntentId,
          });
          checkout = {
            merchantOwned: true,
            paymentRequest: directInvoice.paymentRequest,
            type: "direct_lightning",
            verification: "unverified",
          };
          intent = {
            createdAt: now,
            destinationToken: null,
            direction: request.body.direction,
            expiresAt: directInvoice.expiresAt,
            failureCode: null,
            id: paymentIntentId,
            idempotencyKey: request.body.idempotencyKey,
            provider: null,
            providerReference: null,
            purgeAt: retention.purgeAt,
            quoteId: quote.response.quoteId,
            status: "direct_payment_pending",
            updatedAt: now,
          };
        } else {
          intent = {
            createdAt: now,
            destinationToken: null,
            direction: request.body.direction,
            expiresAt: new Date(quote.response.expiresAt),
            failureCode: null,
            id: paymentIntentId,
            idempotencyKey: request.body.idempotencyKey,
            provider: "fake_treasury",
            providerReference: null,
            purgeAt: retention.purgeAt,
            quoteId: quote.response.quoteId,
            status: "quote_locked",
            updatedAt: now,
          };
          const dispatched = await dispatchProviderIntent(
            config,
            dependencies,
            request.body,
            intent,
            quote,
          );
          checkout = dispatched.checkout;
          intent = dispatched.intent;
        }

        if (request.body.direction === "btc_to_btc") {
          intent = await dependencies.store.saveIntent(intent);
        }
        if (
          intent.quoteId !== request.body.quoteId ||
          intent.direction !== request.body.direction
        ) {
          throw app.httpErrors.conflict(
            "The idempotency key is already bound to another payment request.",
          );
        }
        return reply.status(201).send({
          checkout,
          direction: intent.direction,
          expiresAt: intent.expiresAt.toISOString(),
          paymentIntentId: intent.id,
          quote: quote.response,
          status: intent.status,
        });
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
