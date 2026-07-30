import { readFileSync } from "node:fs";
import { z } from "zod";

const booleanString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const configSchema = z
  .object({
    APP_BASE_URL: z.url().default("http://localhost:5173"),
    BITCOIN_LIQUIDITY_RAIL_MODE: z.literal("fake").default("fake"),
    BRIDGE_ENGINE_MODE: z.enum(["disabled", "fake"]).default("disabled"),
    DATABASE_URL: z.string().min(1).default("postgresql://ntumba:ntumba@localhost:5432/ntumba"),
    FAKE_BITCOIN_TREASURY_BALANCE_SATS: z.coerce.bigint().min(0n).default(5_000_000n),
    FAKE_BITCOIN_TREASURY_INBOUND_CAPACITY_SATS: z.coerce.bigint().min(0n).default(10_000_000n),
    FAKE_BITCOIN_TREASURY_OUTBOUND_CAPACITY_SATS: z.coerce.bigint().min(0n).default(5_000_000n),
    FAKE_LIPILA_BALANCE_ZMW_MINOR: z.coerce.bigint().min(0n).default(5_000_000n),
    FAKE_PROVIDER_CALLBACK_SECRET: z.string().min(32).optional(),
    FLAT_FEE_ZMW: z.string().default("5.00"),
    HOST: z.string().default("0.0.0.0"),
    INTENT_RETENTION_SECONDS: z.coerce.number().int().min(0).max(2_592_000).default(86_400),
    JOBS_ENABLED: booleanString,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),
    MOBILE_MONEY_LIQUIDITY_RAIL_MODE: z.literal("fake").default("fake"),
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
    PROVIDER_EVENT_MAX_PROCESSING_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
    PROVIDER_EVENT_RETRY_BACKOFF_SECONDS: z.coerce.number().int().min(1).max(300).default(5),
    PROVIDER_FINALITY_GRACE_SECONDS: z.coerce.number().int().min(60).max(604_800).default(86_400),
    PUBLIC_REQUEST_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
    QUOTE_RETENTION_SECONDS: z.coerce.number().int().min(0).max(86_400).default(3_600),
    QUOTE_TTL_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    RATE_PROVIDER_MODE: z.literal("fake").default("fake"),
    SERVE_WEB: booleanString,
    SOURCE_PAYMENT_TTL_SECONDS: z.coerce.number().int().min(30).max(3_600).default(180),
    SETTLEMENT_CALLBACK_GRACE_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
    SETTLEMENT_DESTINATION_TTL_SECONDS: z.coerce.number().int().min(40).max(172_800).default(1_200),
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
    if (config.NODE_ENV === "production" && config.BRIDGE_ENGINE_MODE !== "disabled") {
      context.addIssue({
        code: "custom",
        message: "The fake bridge engine cannot be enabled in production.",
        path: ["BRIDGE_ENGINE_MODE"],
      });
    }
    if (
      config.SETTLEMENT_DESTINATION_TTL_SECONDS <
      config.SOURCE_PAYMENT_TTL_SECONDS + config.SETTLEMENT_CALLBACK_GRACE_SECONDS
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SETTLEMENT_DESTINATION_TTL_SECONDS must cover source expiry plus callback processing grace.",
        path: ["SETTLEMENT_DESTINATION_TTL_SECONDS"],
      });
    }
    if (
      config.SETTLEMENT_DESTINATION_TTL_SECONDS <
      config.PUBLIC_REQUEST_TTL_SECONDS + config.QUOTE_TTL_SECONDS
    ) {
      context.addIssue({
        code: "custom",
        message:
          "SETTLEMENT_DESTINATION_TTL_SECONDS must cover the public request lifetime plus quote-confirmation grace.",
        path: ["SETTLEMENT_DESTINATION_TTL_SECONDS"],
      });
    }
  });

export type NtumbaConfig = z.infer<typeof configSchema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): NtumbaConfig {
  if (environment.SETTLEMENT_PROVIDER_MODE !== undefined) {
    throw new Error(
      "Invalid environment configuration: SETTLEMENT_PROVIDER_MODE is obsolete; use the explicit bridge and liquidity-rail gates.",
    );
  }
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
