import { randomUUID } from "node:crypto";
import { ProviderCallbackVerificationError, type SettlementProvider } from "@ntumba/providers";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { PaymentStore, StoredQuote } from "../payment-store.js";

const callbackResponseSchema = z.object({ status: z.enum(["accepted", "duplicate"]) });

function callbackMatchesQuote(
  callback: Awaited<ReturnType<SettlementProvider["verifyCallback"]>>,
  quote: StoredQuote,
): boolean {
  if (callback.direction === "btc_to_zmw") {
    return (
      quote.response.direction === callback.direction &&
      callback.sourceAsset === "BTC" &&
      callback.sourceAmount === quote.payerAmountSats &&
      callback.settlementAsset === "ZMW" &&
      callback.settlementAmount === quote.merchantAmountZmwMinor
    );
  }

  return (
    quote.response.direction === callback.direction &&
    callback.sourceAsset === "ZMW" &&
    callback.sourceAmount === quote.payerAmountZmwMinor &&
    callback.settlementAsset === "BTC" &&
    callback.settlementAmount === quote.merchantAmountSats
  );
}

export function providerCallbackRoutes(
  settlementProvider: SettlementProvider,
  store: PaymentStore,
): FastifyPluginAsyncZod {
  return async (app) => {
    app.removeContentTypeParser("application/json");
    app.addContentTypeParser(
      "application/json",
      { bodyLimit: 32_768, parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );

    app.post(
      "/provider-callbacks/fake",
      {
        config: { rateLimit: { max: 120, timeWindow: "1 minute" } },
        schema: {
          response: { 200: callbackResponseSchema, 202: callbackResponseSchema },
          tags: ["Provider callbacks"],
        },
      },
      async (request, reply) => {
        if (!Buffer.isBuffer(request.body)) {
          throw app.httpErrors.badRequest("The callback body must be JSON.");
        }

        let callback: Awaited<ReturnType<SettlementProvider["verifyCallback"]>>;
        try {
          callback = await settlementProvider.verifyCallback({
            headers: request.headers,
            rawBody: request.body,
          });
        } catch (error) {
          if (error instanceof ProviderCallbackVerificationError) {
            throw app.httpErrors.unauthorized("The callback signature or payload is invalid.");
          }
          throw error;
        }

        const receivedAt = new Date();
        await store.purgeDue(receivedAt);
        const intent = await store.findIntentByProviderReference(
          "fake",
          callback.providerReference,
        );
        if (!intent) {
          throw app.httpErrors.notFound("The callback payment intent was not found.");
        }
        const quote = await store.getQuote(intent.quoteId);
        if (!quote) {
          throw new Error("The callback payment intent has no retained quote.");
        }
        if (intent.direction !== callback.direction || !callbackMatchesQuote(callback, quote)) {
          throw app.httpErrors.conflict("The callback does not match the payment intent.");
        }

        const result = await store.appendProviderEvent({
          id: randomUUID(),
          normalizedStatus: callback.status,
          occurredAt: callback.occurredAt,
          payloadHash: callback.payloadHash,
          paymentIntentId: intent.id,
          processedAt: null,
          provider: "fake",
          providerEventId: callback.eventId,
          purgeAt: intent.purgeAt,
          receivedAt,
        });
        if (result.outcome === "conflict") {
          throw app.httpErrors.conflict(
            "The provider event ID was already used for another event.",
          );
        }
        if (result.outcome === "duplicate") {
          return reply.status(200).send({ status: "duplicate" });
        }
        return reply.status(202).send({ status: "accepted" });
      },
    );
  };
}
