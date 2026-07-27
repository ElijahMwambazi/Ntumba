import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get(
    "/health",
    {
      schema: {
        response: {
          200: z.object({
            service: z.literal("ntumba"),
            status: z.literal("ok"),
            timestamp: z.iso.datetime(),
          }),
        },
        tags: ["System"],
      },
    },
    async () => ({
      service: "ntumba" as const,
      status: "ok" as const,
      timestamp: new Date().toISOString(),
    }),
  );
};
