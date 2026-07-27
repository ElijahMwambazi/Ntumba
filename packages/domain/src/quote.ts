import type { PaymentDirection } from "@ntumba/contracts";
import { ceilDivide } from "./money.js";

const SATOSHIS_PER_BITCOIN = 100_000_000n;
const BASIS_POINTS = 10_000n;

export interface QuoteCalculationInput {
  amountZmwMinor: bigint;
  direction: PaymentDirection;
  flatFeeZmwMinor: bigint;
  rateZmwMinorPerBitcoin: bigint;
  variableFeeBps: bigint;
}

export interface QuoteCalculation {
  amountZmwMinor: bigint;
  direction: PaymentDirection;
  feeZmwMinor: bigint;
  merchantReceivesSats: bigint | null;
  merchantReceivesZmwMinor: bigint | null;
  payerSendsSats: bigint | null;
  payerSendsZmwMinor: bigint | null;
}

export function calculateQuote(input: QuoteCalculationInput): QuoteCalculation {
  if (input.amountZmwMinor <= 0n) {
    throw new Error("Merchant amount must be positive.");
  }
  if (input.flatFeeZmwMinor < 0n || input.variableFeeBps < 0n) {
    throw new Error("Fees cannot be negative.");
  }
  if (input.rateZmwMinorPerBitcoin <= 0n) {
    throw new Error("Exchange rate must be positive.");
  }

  if (input.direction === "btc_to_btc") {
    const settlementSats = ceilDivide(
      input.amountZmwMinor * SATOSHIS_PER_BITCOIN,
      input.rateZmwMinorPerBitcoin,
    );

    return {
      amountZmwMinor: input.amountZmwMinor,
      direction: input.direction,
      feeZmwMinor: 0n,
      merchantReceivesSats: settlementSats,
      merchantReceivesZmwMinor: null,
      payerSendsSats: settlementSats,
      payerSendsZmwMinor: null,
    };
  }

  const variableFee = ceilDivide(input.amountZmwMinor * input.variableFeeBps, BASIS_POINTS);
  const feeZmwMinor = input.flatFeeZmwMinor + variableFee;

  if (input.direction === "btc_to_zmw") {
    const grossZmwMinor = input.amountZmwMinor + feeZmwMinor;
    const payerSendsSats = ceilDivide(
      grossZmwMinor * SATOSHIS_PER_BITCOIN,
      input.rateZmwMinorPerBitcoin,
    );

    return {
      amountZmwMinor: input.amountZmwMinor,
      direction: input.direction,
      feeZmwMinor,
      merchantReceivesSats: null,
      merchantReceivesZmwMinor: input.amountZmwMinor,
      payerSendsSats,
      payerSendsZmwMinor: null,
    };
  }

  const merchantReceivesSats =
    (input.amountZmwMinor * SATOSHIS_PER_BITCOIN) / input.rateZmwMinorPerBitcoin;

  if (merchantReceivesSats <= 0n) {
    throw new Error("Amount is too small to settle over Lightning.");
  }

  return {
    amountZmwMinor: input.amountZmwMinor,
    direction: input.direction,
    feeZmwMinor,
    merchantReceivesSats,
    merchantReceivesZmwMinor: null,
    payerSendsSats: null,
    payerSendsZmwMinor: input.amountZmwMinor + feeZmwMinor,
  };
}
