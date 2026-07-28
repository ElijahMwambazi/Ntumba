import { randomUUID } from "node:crypto";
import type { NtumbaMetrics } from "@ntumba/observability";
import { type BridgeEventVerifier, ProviderCallbackVerificationError } from "@ntumba/providers";
import type { BridgeEngine } from "@ntumba/treasury";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { purgeWithMetrics } from "../observability.js";
import type { PaymentStore, StoredQuote } from "../payment-store.js";

const callbackResponseSchema = z.object({ status: z.enum(["accepted", "duplicate"]) });

function callbackMatchesQuote(
  callback: Awaited<ReturnType<BridgeEventVerifier["verifyCallback"]>>,
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
  bridgeEventVerifier: BridgeEventVerifier,
  bridgeEngine: BridgeEngine,
  store: PaymentStore,
  metrics?: NtumbaMetrics,
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

        let callback: Awaited<ReturnType<BridgeEventVerifier["verifyCallback"]>>;
        try {
          callback = await bridgeEventVerifier.verifyCallback({
            headers: request.headers,
            rawBody: request.body,
          });
        } catch (error) {
          if (error instanceof ProviderCallbackVerificationError) {
            metrics?.recordCallbackRejected(error.reason);
            throw app.httpErrors.unauthorized("The callback signature or payload is invalid.");
          }
          throw error;
        }

        const receivedAt = new Date();
        await purgeWithMetrics(store, metrics, "opportunistic", receivedAt);
        const intent = await store.findIntentByProviderReference(
          "fake_treasury",
          callback.providerReference,
        );
        if (!intent) {
          metrics?.recordCallbackRejected("mismatch");
          throw app.httpErrors.notFound("The callback payment intent was not found.");
        }
        const quote = await store.getQuote(intent.quoteId);
        if (!quote) {
          throw new Error("The callback payment intent has no retained quote.");
        }
        if (intent.direction !== callback.direction || !callbackMatchesQuote(callback, quote)) {
          metrics?.recordCallbackRejected("mismatch");
          throw app.httpErrors.conflict("The callback does not match the payment intent.");
        }

        if (
          !["source_pending", "source_confirming", "source_settled", "failed", "unknown"].includes(
            callback.status,
          )
        ) {
          metrics?.recordCallbackRejected("mismatch");
          throw app.httpErrors.conflict("The callback is not a source-leg event.");
        }
        const normalizedStatus = callback.status as
          | "source_pending"
          | "source_confirming"
          | "source_settled"
          | "failed"
          | "unknown";
        const result = await bridgeEngine.appendProviderEvent({
          id: randomUUID(),
          normalizedStatus,
          occurredAt: callback.occurredAt,
          payloadHash: callback.payloadHash,
          provider: "fake_treasury",
          providerEventId: callback.eventId,
          purgeAt: intent.purgeAt,
          receivedAt,
          sourceReference: callback.providerReference,
        });
        if (result === "conflict") {
          metrics?.recordCallbackRejected("conflict");
          throw app.httpErrors.conflict(
            "The provider event ID was already used for another event.",
          );
        }
        if (result === "duplicate") {
          metrics?.recordCallback("duplicate");
          return reply.status(200).send({ status: "duplicate" });
        }
        metrics?.recordCallback("accepted");
        return reply.status(202).send({ status: "accepted" });
      },
    );
  };
}
