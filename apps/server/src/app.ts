import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import fastifyStatic from "@fastify/static";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { NtumbaConfig } from "@ntumba/config";
import { loadConfig } from "@ntumba/config";
import type { NtumbaMetrics } from "@ntumba/observability";
import { FakeDirectLightningProvider, FakeSettlementProvider } from "@ntumba/providers";
import Fastify from "fastify";
import {
  hasZodFastifySchemaValidationErrors,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
} from "fastify-type-provider-zod";
import { InMemoryPaymentStore } from "./payment-store.js";
import { InMemoryPublicRequestStore } from "./public-request-store.js";
import { healthRoutes } from "./routes/health.js";
import { type PaymentRouteDependencies, paymentIntentRoutes } from "./routes/payment-intents.js";
import { providerCallbackRoutes } from "./routes/provider-callbacks.js";
import { publicRequestRoutes } from "./routes/public-requests.js";
import { quoteRoutes } from "./routes/quotes.js";

export async function buildApp(
  config: NtumbaConfig = loadConfig(),
  dependencies: PaymentRouteDependencies = {
    directLightningProvider: new FakeDirectLightningProvider(),
    settlementProvider: new FakeSettlementProvider({
      callbackSecret: config.FAKE_PROVIDER_CALLBACK_SECRET,
    }),
    store: new InMemoryPaymentStore(),
  },
  publicRequestStore = new InMemoryPublicRequestStore(),
  metrics?: NtumbaMetrics,
) {
  const logger =
    config.NODE_ENV === "test"
      ? false
      : config.NODE_ENV === "development"
        ? {
            level: config.LOG_LEVEL,
            transport: {
              target: "pino-pretty",
              options: { colorize: true, translateTime: "SYS:standard" },
            },
          }
        : { level: config.LOG_LEVEL };

  const app = Fastify({
    logger,
    requestIdHeader: "x-request-id",
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  if (metrics) {
    const starts = new WeakMap<object, bigint>();
    app.addHook("onRequest", async (request) => {
      starts.set(request, process.hrtime.bigint());
    });
    app.addHook("onResponse", async (request, reply) => {
      const startedAt = starts.get(request);
      metrics.observeHttp({
        durationSeconds: startedAt
          ? Number(process.hrtime.bigint() - startedAt) / 1_000_000_000
          : 0,
        method: request.method,
        routeTemplate: request.routeOptions.url,
        statusCode: reply.statusCode,
      });
    });
  }

  await app.register(sensible);
  await app.register(helmet, config.SERVE_WEB ? {} : { contentSecurityPolicy: false });
  await app.register(cors, {
    origin: config.NODE_ENV === "production" ? config.APP_BASE_URL : true,
  });
  await app.register(rateLimit, {
    max: 60,
    timeWindow: "1 minute",
  });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Ntumba API",
        description: "Accountless provider-direct Bitcoin and Kwacha payment coordination.",
        version: "0.1.0",
      },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, {
    routePrefix: "/documentation",
  });

  app.setErrorHandler((error, request, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({
        error: {
          code: "INVALID_REQUEST",
          message: "The request contains invalid payment details.",
          requestId: request.id,
        },
      });
    }

    const requestError = error as Error & { statusCode?: number };
    const statusCode = typeof requestError.statusCode === "number" ? requestError.statusCode : 500;
    if (statusCode >= 500) {
      request.log.error({ errorType: requestError.name }, "request failed");
    }

    return reply.status(statusCode).send({
      error: {
        code: statusCode >= 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR",
        message: statusCode >= 500 ? "The request could not be completed." : requestError.message,
        requestId: request.id,
      },
    });
  });

  await app.register(healthRoutes, { prefix: "/api" });
  await app.register(quoteRoutes(config, dependencies.store), { prefix: "/api/v1" });
  await app.register(paymentIntentRoutes(config, { ...dependencies, metrics }), {
    prefix: "/api/v1",
  });
  await app.register(
    providerCallbackRoutes(dependencies.settlementProvider, dependencies.store, metrics),
    { prefix: "/api/v1" },
  );
  await app.register(publicRequestRoutes(config, publicRequestStore), { prefix: "/api/v1" });

  if (config.SERVE_WEB) {
    const currentDirectory = dirname(fileURLToPath(import.meta.url));
    const webRoot = resolve(currentDirectory, "../../web/dist");

    if (!existsSync(webRoot)) {
      app.log.warn({ webRoot }, "compiled web application was not found");
    } else {
      await app.register(fastifyStatic, {
        root: webRoot,
        wildcard: false,
      });
      app.setNotFoundHandler((request, reply) => {
        if (request.method === "GET" && !request.url.startsWith("/api")) {
          return reply.sendFile("index.html");
        }
        return reply.status(404).send({
          error: {
            code: "NOT_FOUND",
            message: "Route not found.",
            requestId: request.id,
          },
        });
      });
    }
  }

  return app;
}
