import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  createPublicRequestPaymentIntentSchema,
  createPublicRequestRequestSchema,
  paymentIntentResponseSchema,
  publicPaymentRequestSchema,
} from "@ntumba/contracts";
import type { SettlementDestinationVault } from "@ntumba/treasury";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { PublicRequestStore } from "../public-request-store.js";
import { createPaymentIntentForRequest, type PaymentRouteDependencies } from "./payment-intents.js";
import { createAndStoreQuote } from "./quotes.js";

const directionFor = {
  "BTC:BTC": "btc_to_btc",
  "BTC:ZMW": "btc_to_zmw",
  "ZMW:BTC": "zmw_to_btc",
} as const;

export function publicRequestRoutes(
  config: NtumbaConfig,
  store: PublicRequestStore,
  destinationVault: SettlementDestinationVault,
  paymentDependencies: PaymentRouteDependencies,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/public-requests",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          body: createPublicRequestRequestSchema,
          response: { 201: publicPaymentRequestSchema },
          tags: ["Payments"],
        },
      },
      async (request, reply) => {
        const now = new Date();
        await store.purgeDue(now);
        const existing = await store.findByIdempotencyKey(request.body.idempotencyKey);
        if (existing) {
          if (!destinationVault.read(existing.destinationLookupToken, now)) {
            throw app.httpErrors.gone("Payment request unavailable or expired.");
          }
          return reply.status(201).send(existing.request);
        }

        const payerMethods = [...new Set(request.body.payerMethods)];
        if (payerMethods.length !== request.body.payerMethods.length) {
          throw app.httpErrors.badRequest("Payment methods must be unique.");
        }
        if (
          request.body.receiveAsset === "ZMW" &&
          (request.body.destination.type !== "mobile_money" ||
            payerMethods.length !== 1 ||
            payerMethods[0] !== "BTC")
        ) {
          throw app.httpErrors.badRequest(
            "Mobile Money requests require one Bitcoin payer option.",
          );
        }
        if (
          request.body.receiveAsset === "BTC" &&
          request.body.destination.type === "mobile_money"
        ) {
          throw app.httpErrors.badRequest("Bitcoin requests require a Bitcoin destination.");
        }

        const options = await Promise.all(
          payerMethods.map(async (payerMethod) => {
            const key = `${payerMethod}:${request.body.receiveAsset}` as keyof typeof directionFor;
            const direction = directionFor[key];
            if (!direction) {
              throw app.httpErrors.badRequest("The payment method cannot settle this request.");
            }
            return {
              payerMethod,
              quote: await createAndStoreQuote(config, paymentDependencies.store, {
                amountZmw: request.body.amountZmw,
                direction,
              }),
            };
          }),
        );
        const expiresAt = new Date(
          Math.min(...options.map((option) => new Date(option.quote.expiresAt).getTime())),
        );
        const destinationExpiresAt = new Date(
          now.getTime() + config.SETTLEMENT_DESTINATION_TTL_SECONDS * 1_000,
        );
        if (expiresAt <= now || destinationExpiresAt <= expiresAt) {
          throw new Error("Public request lifecycle configuration is invalid.");
        }
        const destinationLookupToken = destinationVault.put(
          request.body.destination,
          destinationExpiresAt,
        );
        const publicRequest = {
          amountZmw: request.body.amountZmw,
          createdAt: now.toISOString(),
          developmentOnly: true as const,
          expiresAt: expiresAt.toISOString(),
          options,
          publicId: randomUUID(),
          receiveAsset: request.body.receiveAsset,
        };
        const saved = await store.save({
          destinationLookupToken,
          idempotencyKey: request.body.idempotencyKey,
          purgeAt: new Date(expiresAt.getTime() + config.INTENT_RETENTION_SECONDS * 1_000),
          request: publicRequest,
        });
        if (!saved.created) {
          destinationVault.delete(destinationLookupToken);
        }
        return reply.status(201).send(saved.record.request);
      },
    );

    app.get(
      "/public-requests/:publicId",
      {
        schema: {
          params: z.object({ publicId: z.uuid() }),
          response: { 200: publicPaymentRequestSchema },
          tags: ["Payments"],
        },
      },
      async (request) => {
        const now = new Date();
        await store.purgeDue(now);
        const stored = await store.get(request.params.publicId);
        if (
          !stored ||
          new Date(stored.request.expiresAt) <= now ||
          !destinationVault.read(stored.destinationLookupToken, now)
        ) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        return stored.request;
      },
    );

    app.post(
      "/public-requests/:publicId/payment-intents",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          body: createPublicRequestPaymentIntentSchema,
          params: z.object({ publicId: z.uuid() }),
          response: { 201: paymentIntentResponseSchema },
          tags: ["Payments"],
        },
      },
      async (request, reply) => {
        const now = new Date();
        const stored = await store.get(request.params.publicId);
        if (!stored || new Date(stored.request.expiresAt) <= now) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        const destination = destinationVault.read(stored.destinationLookupToken, now);
        if (!destination) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        const option = stored.request.options.find(
          (candidate) => candidate.payerMethod === request.body.payerMethod,
        );
        if (!option) {
          throw app.httpErrors.badRequest("The payment method is not available.");
        }
        const direction = option.quote.direction;
        if (
          (direction === "btc_to_zmw" && destination.type !== "mobile_money") ||
          (direction !== "btc_to_zmw" && destination.type === "mobile_money")
        ) {
          throw new Error("A public request destination does not match its durable option.");
        }
        const paymentInput =
          direction === "btc_to_zmw"
            ? {
                destination:
                  destination.type === "mobile_money"
                    ? destination
                    : (() => {
                        throw new Error("A conversion request has no mobile-money destination.");
                      })(),
                direction,
                idempotencyKey: request.body.idempotencyKey,
                quoteId: option.quote.quoteId,
              }
            : {
                destination:
                  destination.type !== "mobile_money"
                    ? destination
                    : (() => {
                        throw new Error("A Bitcoin request has no Bitcoin destination.");
                      })(),
                direction,
                idempotencyKey: request.body.idempotencyKey,
                quoteId: option.quote.quoteId,
              };
        const response = await createPaymentIntentForRequest(
          config,
          paymentDependencies,
          paymentInput,
          app.httpErrors,
          now,
        );
        return reply.status(201).send(response);
      },
    );
  };
}
