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
import type {
  DirectLightningProvider,
  ProviderPaymentIntent,
  SettlementProvider,
} from "@ntumba/providers";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type {
  PaymentStore,
  StoredPaymentIntent,
  StoredProviderIntentOutbox,
} from "../payment-store.js";

export interface PaymentRouteDependencies {
  directLightningProvider: DirectLightningProvider;
  settlementProvider: SettlementProvider;
  store: PaymentStore;
}

type BridgePaymentIntentRequest = Exclude<CreatePaymentIntentRequest, { direction: "btc_to_btc" }>;

function createProviderIntentOutbox(
  intent: StoredPaymentIntent,
  attemptedAt: Date,
): StoredProviderIntentOutbox {
  return {
    attemptCount: 1,
    createdAt: attemptedAt,
    id: randomUUID(),
    lastAttemptAt: attemptedAt,
    lastFailureCode: null,
    paymentIntentId: intent.id,
    processedAt: null,
    provider: "fake",
    purgeAt: intent.purgeAt,
    updatedAt: attemptedAt,
  };
}

async function dispatchProviderIntent(
  dependencies: PaymentRouteDependencies,
  input: BridgePaymentIntentRequest,
  stagedIntent: StoredPaymentIntent,
): Promise<{ checkout: CheckoutInstructions; intent: StoredPaymentIntent }> {
  let providerIntent: ProviderPaymentIntent;
  try {
    providerIntent = await dependencies.settlementProvider.createPaymentIntent({
      destination: input.destination,
      direction: input.direction,
      idempotencyKey: input.idempotencyKey,
      providerQuoteReference: input.quoteId,
    });
  } catch (error) {
    await dependencies.store.recordProviderIntentFailure(
      stagedIntent.id,
      "PROVIDER_REQUEST_FAILED",
      new Date(),
    );
    throw error;
  }

  const intent = await dependencies.store.completeProviderIntent(stagedIntent.id, {
    destinationToken: providerIntent.destinationToken,
    expiresAt: providerIntent.expiresAt,
    providerReference: providerIntent.providerReference,
    updatedAt: new Date(),
  });
  if (
    intent.providerReference !== providerIntent.providerReference ||
    intent.destinationToken !== providerIntent.destinationToken
  ) {
    throw new Error("Provider idempotency returned a conflicting payment intent.");
  }

  return {
    checkout: {
      checkoutUrl: providerIntent.checkoutUrl,
      instructions: providerIntent.payerInstructions,
      providerReference: providerIntent.providerReference,
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
        await dependencies.store.purgeDue(new Date());
        const quote = await dependencies.store.getQuote(request.body.quoteId);
        if (!quote) {
          throw app.httpErrors.gone("The quote has expired. Create a new quote.");
        }
        if (quote.response.direction !== request.body.direction) {
          throw app.httpErrors.badRequest("The payment direction does not match the quote.");
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
            if (intent.status === "created") {
              const attemptedAt = new Date();
              intent = await dependencies.store.stageProviderIntent(
                intent,
                createProviderIntentOutbox(intent, attemptedAt),
              );
            }
            const dispatched = await dispatchProviderIntent(dependencies, request.body, intent);
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
            provider: "fake",
            providerReference: null,
            purgeAt: retention.purgeAt,
            quoteId: quote.response.quoteId,
            status: "created",
            updatedAt: now,
          };
          intent = await dependencies.store.stageProviderIntent(
            intent,
            createProviderIntentOutbox(intent, now),
          );
          if (
            intent.quoteId !== request.body.quoteId ||
            intent.direction !== request.body.direction
          ) {
            throw app.httpErrors.conflict(
              "The idempotency key is already bound to another payment request.",
            );
          }
          const dispatched = await dispatchProviderIntent(dependencies, request.body, intent);
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
        await dependencies.store.purgeDue(new Date());
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
