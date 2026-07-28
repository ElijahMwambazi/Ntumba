import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const configSchema = z
  .object({
    APP_BASE_URL: z.url().default("http://localhost:5173"),
    DATABASE_URL: z.string().min(1).default("postgresql://ntumba:ntumba@localhost:5432/ntumba"),
    FAKE_PROVIDER_CALLBACK_SECRET: z.string().min(32).optional(),
    FLAT_FEE_ZMW: z.string().default("5.00"),
    HOST: z.string().default("0.0.0.0"),
    INTENT_RETENTION_SECONDS: z.coerce.number().int().min(0).max(2_592_000).default(86_400),
    JOBS_ENABLED: booleanString,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    NTUMBA_BUILD_COMMIT: z
      .string()
      .regex(/^(?:development|unknown|[0-9a-f]{7,64})$/)
      .default("development"),
    OPS_ENABLED: booleanString,
    OPS_HOST: z.string().min(1).default("127.0.0.1"),
    OPS_METRICS_TOKEN: z.string().min(32).max(256).regex(/^\S+$/).optional(),
    OPS_METRICS_TOKEN_FILE: z.string().min(1).optional(),
    OPS_PORT: z.coerce.number().int().min(1).max(65_535).default(9091),
    PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
    QUOTE_RETENTION_SECONDS: z.coerce.number().int().min(0).max(86_400).default(3_600),
    QUOTE_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    RATE_PROVIDER_MODE: z.enum(["fake", "live"]).default("fake"),
    SERVE_WEB: booleanString,
    SETTLEMENT_PROVIDER_MODE: z.literal("fake").default("fake"),
    STATIC_BTC_ZMW_RATE: z.string().default("1800000.00"),
    VARIABLE_FEE_BPS: z.coerce.number().int().min(0).max(10_000).default(0),
  })
  .superRefine((config, context) => {
    if (config.OPS_ENABLED && !config.OPS_METRICS_TOKEN) {
      context.addIssue({
        code: "custom",
        message:
          "OPS_METRICS_TOKEN must contain at least 32 non-whitespace characters when operational endpoints are enabled.",
        path: ["OPS_METRICS_TOKEN"],
      });
    }
    if (config.OPS_ENABLED && config.OPS_PORT === config.PORT) {
      context.addIssue({
        code: "custom",
        message: "The operational listener must not share the public listener port.",
        path: ["OPS_PORT"],
      });
    }
  });

export type NtumbaConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): NtumbaConfig {
  const resolvedEnvironment = { ...environment };
  if (!resolvedEnvironment.OPS_METRICS_TOKEN && resolvedEnvironment.OPS_METRICS_TOKEN_FILE) {
    try {
      resolvedEnvironment.OPS_METRICS_TOKEN = readFileSync(
        resolvedEnvironment.OPS_METRICS_TOKEN_FILE,
        "utf8",
      ).trim();
    } catch {
      throw new Error(
        "Invalid environment configuration: OPS_METRICS_TOKEN_FILE could not be read.",
      );
    }
  }

  const parsed = configSchema.safeParse(resolvedEnvironment);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
