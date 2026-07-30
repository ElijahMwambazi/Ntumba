import { randomUUID } from "node:crypto";
import type { NtumbaConfig } from "@ntumba/config";
import {
  type CreateQuoteResponse,
  createQuoteRequestSchema,
  createQuoteResponseSchema,
} from "@ntumba/contracts";
import {
  calculateQuote,
  createRetentionWindow,
  formatZmwFromMinor,
  parseZmwToMinor,
} from "@ntumba/domain";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { PaymentStore } from "../payment-store.js";

export async function createAndStoreQuote(
  config: NtumbaConfig,
  store: PaymentStore,
  input: { amountZmw: string; direction: "btc_to_btc" | "btc_to_zmw" | "zmw_to_btc" },
  now = new Date(),
): Promise<CreateQuoteResponse> {
  if (config.RATE_PROVIDER_MODE !== "fake") {
    throw new Error("RATE_PROVIDER_UNAVAILABLE");
  }
  const amountZmwMinor = parseZmwToMinor(input.amountZmw);
  const rateZmwMinorPerBitcoin = parseZmwToMinor(config.STATIC_BTC_ZMW_RATE);
  const flatFeeZmwMinor = parseZmwToMinor(config.FLAT_FEE_ZMW);
  const quote = calculateQuote({
    amountZmwMinor,
    direction: input.direction,
    flatFeeZmwMinor,
    rateZmwMinorPerBitcoin,
    variableFeeBps: BigInt(config.VARIABLE_FEE_BPS),
  });
  const retention = createRetentionWindow(
    now,
    config.QUOTE_TTL_SECONDS,
    config.QUOTE_RETENTION_SECONDS,
  );
  const amountZmw = formatZmwFromMinor(quote.amountZmwMinor);
  const feeZmw = formatZmwFromMinor(quote.feeZmwMinor);
  const quoteId = randomUUID();
  const common = {
    amountZmw,
    direction: quote.direction,
    exchangeRate: `1 BTC = K${config.STATIC_BTC_ZMW_RATE}`,
    expiresAt: retention.expiresAt.toISOString(),
    feeZmw,
    quoteId,
  };
  let response: CreateQuoteResponse;
  if (quote.direction === "btc_to_zmw") {
    const payerSats = quote.payerSendsSats;
    if (payerSats === null) {
      throw new Error("Quote calculation did not produce a Lightning source amount.");
    }
    response = {
      ...common,
      merchantReceives: { amount: amountZmw, asset: "ZMW", display: `K${amountZmw}` },
      payerSends: {
        amount: payerSats.toString(),
        asset: "BTC",
        display: `${payerSats.toLocaleString()} sats`,
      },
    };
  } else if (quote.direction === "btc_to_btc") {
    const payerSats = quote.payerSendsSats;
    const merchantSats = quote.merchantReceivesSats;
    if (payerSats === null || merchantSats === null) {
      throw new Error("Quote calculation did not produce direct Lightning amounts.");
    }
    response = {
      ...common,
      merchantReceives: {
        amount: merchantSats.toString(),
        asset: "BTC",
        display: `${merchantSats.toLocaleString()} sats`,
      },
      payerSends: {
        amount: payerSats.toString(),
        asset: "BTC",
        display: `${payerSats.toLocaleString()} sats`,
      },
    };
  } else {
    const payerZmwMinor = quote.payerSendsZmwMinor;
    const merchantSats = quote.merchantReceivesSats;
    if (payerZmwMinor === null || merchantSats === null) {
      throw new Error("Quote calculation did not produce the expected settlement amounts.");
    }
    const payerZmw = formatZmwFromMinor(payerZmwMinor);
    response = {
      ...common,
      merchantReceives: {
        amount: merchantSats.toString(),
        asset: "BTC",
        display: `${merchantSats.toLocaleString()} sats`,
      },
      payerSends: { amount: payerZmw, asset: "ZMW", display: `K${payerZmw}` },
    };
  }
  await store.saveQuote({
    amountZmwMinor: quote.amountZmwMinor,
    feeZmwMinor: quote.feeZmwMinor,
    merchantAmountSats: quote.merchantReceivesSats,
    merchantAmountZmwMinor: quote.merchantReceivesZmwMinor,
    payerAmountSats: quote.payerSendsSats,
    payerAmountZmwMinor: quote.payerSendsZmwMinor,
    purgeAt: retention.purgeAt,
    rateZmwMinorPerBitcoin,
    response,
  });
  return response;
}

export function quoteRoutes(config: NtumbaConfig, store: PaymentStore): FastifyPluginAsyncZod {
  return async (app) => {
    app.post(
      "/quotes",
      {
        config: {
          rateLimit: {
            max: 20,
            timeWindow: "1 minute",
          },
        },
        schema: {
          body: createQuoteRequestSchema,
          response: {
            200: createQuoteResponseSchema,
          },
          tags: ["Payments"],
        },
      },
      async (request) => {
        if (config.RATE_PROVIDER_MODE !== "fake") {
          throw app.httpErrors.serviceUnavailable("Live rate provider is not implemented.");
        }
        return createAndStoreQuote(config, store, request.body);
      },
    );
  };
}
