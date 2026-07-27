import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import { createPublicRequestRequestSchema, publicPaymentRequestSchema } from "@ntumba/contracts";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { PublicRequestStore } from "../public-request-store.js";

const directionFor = {
  "BTC:BTC": "btc_to_btc",
  "BTC:ZMW": "btc_to_zmw",
  "ZMW:BTC": "zmw_to_btc",
} as const;

export function publicRequestRoutes(
  config: NtumbaConfig,
  store: PublicRequestStore,
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
        await store.purgeDue(new Date());
        const existing = await store.findByIdempotencyKey(request.body.idempotencyKey);
        if (existing) {
          return reply.status(201).send(existing);
        }

        const seenMethods = new Set<string>();
        for (const option of request.body.options) {
          const key =
            `${option.payerMethod}:${request.body.receiveAsset}` as keyof typeof directionFor;
          const expectedDirection = directionFor[key];
          if (
            !expectedDirection ||
            option.intent.direction !== expectedDirection ||
            option.intent.quote.direction !== expectedDirection ||
            option.intent.quote.amountZmw !== request.body.amountZmw ||
            seenMethods.has(option.payerMethod)
          ) {
            throw app.httpErrors.badRequest(
              "The payment options do not match the merchant request.",
            );
          }
          seenMethods.add(option.payerMethod);
        }

        if (request.body.receiveAsset === "ZMW" && !seenMethods.has("BTC")) {
          throw app.httpErrors.badRequest("Mobile Money requests require a Bitcoin payer option.");
        }

        const createdAt = new Date();
        const expiresAt = new Date(
          Math.min(
            ...request.body.options.map((option) => new Date(option.intent.expiresAt).getTime()),
          ),
        );
        if (expiresAt.getTime() <= createdAt.getTime()) {
          throw app.httpErrors.gone("The payment options have expired.");
        }

        const publicRequest = {
          amountZmw: request.body.amountZmw,
          createdAt: createdAt.toISOString(),
          developmentOnly: true as const,
          expiresAt: expiresAt.toISOString(),
          merchantLabel: request.body.merchantLabel ?? null,
          options: request.body.options,
          publicId: randomUUID(),
          receiveAsset: request.body.receiveAsset,
          reference: request.body.reference ?? null,
        };
        const saved = await store.save(
          request.body.idempotencyKey,
          publicRequest,
          new Date(expiresAt.getTime() + config.INTENT_RETENTION_SECONDS * 1_000),
        );
        return reply.status(201).send(saved);
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
        await store.purgeDue(new Date());
        const publicRequest = await store.get(request.params.publicId);
        if (!publicRequest) {
          throw app.httpErrors.notFound("Payment request not found or no longer retained.");
        }
        return publicRequest;
      },
    );
  };
}
