import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  createPublicRequestPaymentIntentSchema,
  createPublicRequestQuoteSchema,
  createPublicRequestRequestSchema,
  createQuoteResponseSchema,
  paymentIntentResponseSchema,
  publicPaymentRequestSchema,
  type SettlementDestination,
} from "@ntumba/contracts";
import { formatZmwFromMinor, parseZmwToMinor } from "@ntumba/domain";
import type { SettlementDestinationVault } from "@ntumba/treasury";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { PublicRequestStore, StoredPublicRequest } from "../public-request-store.js";
import {
  createPaymentIntentForRequest,
  type PaymentRouteDependencies,
  resumeDurableProviderIntent,
} from "./payment-intents.js";
import { createAndStoreQuote } from "./quotes.js";

const directionFor = {
  "BTC:BTC": "btc_to_btc",
  "BTC:ZMW": "btc_to_zmw",
  "ZMW:BTC": "zmw_to_btc",
} as const;

function sameDestination(left: SettlementDestination, right: SettlementDestination): boolean {
  if (left.type !== right.type) {
    return false;
  }
  if (left.type === "mobile_money" && right.type === "mobile_money") {
    return left.network === right.network && left.phone === right.phone;
  }
  if (left.type === "lightning_address" && right.type === "lightning_address") {
    return left.address === right.address;
  }
  return (
    left.type === "lightning_invoice" &&
    right.type === "lightning_invoice" &&
    left.invoice === right.invoice
  );
}

function equivalentRequest(
  existing: StoredPublicRequest,
  input: {
    amountZmw: string;
    destination: SettlementDestination;
    payerMethods: Array<"BTC" | "ZMW">;
    receiveAsset: "BTC" | "ZMW";
  },
  destinationVault: SettlementDestinationVault,
  now: Date,
): "equivalent" | "missing_destination" | "different" {
  const methods = [...input.payerMethods].sort();
  const existingMethods = existing.request.options.map((option) => option.payerMethod).sort();
  if (
    existing.request.amountZmw !== formatZmwFromMinor(parseZmwToMinor(input.amountZmw)) ||
    existing.request.receiveAsset !== input.receiveAsset ||
    methods.join(":") !== existingMethods.join(":")
  ) {
    return "different";
  }
  const destination = destinationVault.read(existing.destinationLookupToken, now);
  if (!destination) {
    return "missing_destination";
  }
  return sameDestination(destination, input.destination) ? "equivalent" : "different";
}

function validatedOptions(receiveAsset: "BTC" | "ZMW", payerMethods: Array<"BTC" | "ZMW">) {
  const methods = [...new Set(payerMethods)];
  if (methods.length !== payerMethods.length) {
    return null;
  }
  const expected = receiveAsset === "ZMW" ? ["BTC"] : ["BTC", "ZMW"];
  if ([...methods].sort().join(":") !== [...expected].sort().join(":")) {
    return null;
  }
  return methods.map((payerMethod) => ({
    direction: directionFor[`${payerMethod}:${receiveAsset}` as keyof typeof directionFor],
    payerMethod,
  }));
}

export function publicRequestRoutes(
  config: NtumbaConfig,
  store: PublicRequestStore,
  destinationVault: SettlementDestinationVault,
  paymentDependencies: PaymentRouteDependencies,
  currentTime: () => Date = () => new Date(),
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
        const now = currentTime();
        await store.purgeDue(now);
        const existing = await store.findByIdempotencyKey(request.body.idempotencyKey);
        if (existing) {
          const equivalence = equivalentRequest(existing, request.body, destinationVault, now);
          if (equivalence === "missing_destination") {
            throw app.httpErrors.gone("Payment request unavailable or expired.");
          }
          if (equivalence === "different") {
            throw app.httpErrors.conflict(
              "The idempotency key is already bound to another payment request.",
            );
          }
          return reply.status(201).send(existing.request);
        }

        const options = validatedOptions(request.body.receiveAsset, request.body.payerMethods);
        if (!options) {
          throw app.httpErrors.badRequest(
            "The payer methods do not match the selected receive asset.",
          );
        }
        if (
          request.body.receiveAsset === "ZMW" &&
          request.body.destination.type !== "mobile_money"
        ) {
          throw app.httpErrors.badRequest("Mobile Money requests require a mobile destination.");
        }
        if (
          request.body.receiveAsset === "BTC" &&
          request.body.destination.type === "mobile_money"
        ) {
          throw app.httpErrors.badRequest("Bitcoin requests require a Bitcoin destination.");
        }

        const expiresAt = new Date(now.getTime() + config.PUBLIC_REQUEST_TTL_SECONDS * 1_000);
        const destinationExpiresAt = new Date(
          now.getTime() + config.SETTLEMENT_DESTINATION_TTL_SECONDS * 1_000,
        );
        if (destinationExpiresAt < expiresAt) {
          throw new Error("Public request lifecycle configuration is invalid.");
        }
        const destinationLookupToken = destinationVault.put(
          request.body.destination,
          destinationExpiresAt,
        );
        const publicRequest = {
          amountZmw: formatZmwFromMinor(parseZmwToMinor(request.body.amountZmw)),
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
          status: "open",
        });
        if (!saved.created) {
          destinationVault.delete(destinationLookupToken);
          const equivalence = equivalentRequest(saved.record, request.body, destinationVault, now);
          if (equivalence === "missing_destination") {
            throw app.httpErrors.gone("Payment request unavailable or expired.");
          }
          if (equivalence === "different") {
            throw app.httpErrors.conflict(
              "The idempotency key is already bound to another payment request.",
            );
          }
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
        const now = currentTime();
        await store.purgeDue(now);
        const stored = await store.get(request.params.publicId);
        if (!stored) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (new Date(stored.request.expiresAt) <= now) {
          await store.expire(stored.request.publicId, now);
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (
          stored.status !== "open" ||
          !destinationVault.read(stored.destinationLookupToken, now)
        ) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        return stored.request;
      },
    );

    app.post(
      "/public-requests/:publicId/quotes",
      {
        config: { rateLimit: { max: 20, timeWindow: "1 minute" } },
        schema: {
          body: createPublicRequestQuoteSchema,
          params: z.object({ publicId: z.uuid() }),
          response: { 201: createQuoteResponseSchema },
          tags: ["Payments"],
        },
      },
      async (request, reply) => {
        const now = currentTime();
        const stored = await store.get(request.params.publicId);
        if (!stored) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (new Date(stored.request.expiresAt) <= now) {
          await store.expire(stored.request.publicId, now);
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (
          stored.status !== "open" ||
          !destinationVault.read(stored.destinationLookupToken, now)
        ) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        const option = stored.request.options.find(
          (candidate) => candidate.payerMethod === request.body.payerMethod,
        );
        if (!option) {
          throw app.httpErrors.badRequest("The payment method is not available.");
        }
        const quote = await createAndStoreQuote(
          config,
          paymentDependencies.store,
          {
            amountZmw: stored.request.amountZmw,
            direction: option.direction,
          },
          now,
        );
        const bound = await store.bindQuote({
          createdAt: now,
          direction: option.direction,
          idempotencyKey: request.body.idempotencyKey,
          payerMethod: option.payerMethod,
          publicRequestId: stored.request.publicId,
          quote,
        });
        if (bound.outcome === "conflict") {
          throw app.httpErrors.conflict(
            "The idempotency key is already bound to another quote selection.",
          );
        }
        if (bound.outcome === "unavailable") {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (bound.outcome !== "created" && bound.outcome !== "replay") {
          throw new Error("The public quote binding returned an unsupported outcome.");
        }
        return reply.status(201).send(bound.quote);
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
        const now = currentTime();
        const stored = await store.get(request.params.publicId);
        if (!stored) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        const option = stored.request.options.find(
          (candidate) => candidate.payerMethod === request.body.payerMethod,
        );
        if (!option) {
          throw app.httpErrors.badRequest("The payment method is not available.");
        }
        const existingClaim = await store.getClaim(stored.request.publicId);
        if (existingClaim) {
          if (
            existingClaim.selectionIdempotencyKey !== request.body.idempotencyKey ||
            existingClaim.quoteId !== request.body.quoteId ||
            existingClaim.payerMethod !== request.body.payerMethod ||
            existingClaim.direction !== option.direction
          ) {
            throw app.httpErrors.conflict(
              "This one-time payment request has already been claimed.",
            );
          }
          const resumed = await resumeDurableProviderIntent(
            paymentDependencies,
            existingClaim.paymentIntentId,
            existingClaim.quoteId,
          );
          if (resumed) {
            return reply.status(201).send(resumed);
          }
        }
        const destination = destinationVault.read(stored.destinationLookupToken, now);
        if (!destination) {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        const claim = await store.claim({
          direction: option.direction,
          now,
          payerMethod: option.payerMethod,
          paymentIntentId: randomUUID(),
          publicRequestId: stored.request.publicId,
          quoteId: request.body.quoteId,
          selectionIdempotencyKey: request.body.idempotencyKey,
        });
        if (claim.outcome === "conflict") {
          throw app.httpErrors.conflict("This one-time payment request has already been claimed.");
        }
        if (claim.outcome === "quote_expired") {
          throw app.httpErrors.gone("The quote has expired. Create a new quote.");
        }
        if (claim.outcome === "invalid_quote") {
          throw app.httpErrors.badRequest("The quote does not belong to this payment request.");
        }
        if (claim.outcome === "unsupported") {
          throw app.httpErrors.badRequest("The payment method is not available.");
        }
        if (claim.outcome === "expired" || claim.outcome === "missing") {
          throw app.httpErrors.gone("Payment request unavailable or expired.");
        }
        if (claim.outcome !== "claimed" && claim.outcome !== "replay") {
          throw new Error("The public request claim returned an unsupported outcome.");
        }
        const durableClaim = claim.claim;

        const direction = durableClaim.direction;
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
                idempotencyKey: `public-claim:${durableClaim.paymentIntentId}`,
                quoteId: durableClaim.quoteId,
              }
            : {
                destination:
                  destination.type !== "mobile_money"
                    ? destination
                    : (() => {
                        throw new Error("A Bitcoin request has no Bitcoin destination.");
                      })(),
                direction,
                idempotencyKey: `public-claim:${durableClaim.paymentIntentId}`,
                quoteId: durableClaim.quoteId,
              };
        const response = await createPaymentIntentForRequest(
          config,
          paymentDependencies,
          paymentInput,
          app.httpErrors,
          now,
          durableClaim.paymentIntentId,
        );
        return reply.status(201).send(response);
      },
    );
  };
}
