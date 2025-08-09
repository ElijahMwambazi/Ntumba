import { api, APIError } from "encore.dev/api";
import { exchangeDB } from "./db";
import { exchangeRateService } from "./exchange_rate_service";
import { liquidityService } from "./liquidity_service";
import { voltageClient } from "./voltage_client";
import type { RecipientInfo } from "./types";

interface CreateBtcToZmwRequest {
  amount_zmw: number;
  recipient_info: RecipientInfo;
}

interface CreateBtcToZmwResponse {
  transaction_id: string;
  lightning_invoice: string;
  amount_sats: number;
  exchange_rate: number;
  expires_at: string;
}

// Creates a new BTC to ZMW transaction.
export const createBtcToZmw = api<CreateBtcToZmwRequest, CreateBtcToZmwResponse>(
  { expose: true, method: "POST", path: "/exchange/btc-to-zmw" },
  async (req) => {
    if (req.amount_zmw <= 0) {
      throw APIError.invalidArgument("Amount must be positive");
    }

    if (!req.recipient_info.phone && !req.recipient_info.bank_account) {
      throw APIError.invalidArgument("Recipient phone or bank account required");
    }

    // Get current exchange rate
    const rate = await exchangeRateService.getCurrentRate();
    const amountSats = exchangeRateService.zmwToSats(req.amount_zmw, rate);

    // Check ZMW liquidity availability
    const hasLiquidity = await liquidityService.checkAvailability("ZMW", req.amount_zmw);
    if (!hasLiquidity) {
      throw APIError.resourceExhausted("Insufficient ZMW liquidity");
    }

    // Reserve ZMW liquidity
    await liquidityService.reserveLiquidity("ZMW", req.amount_zmw);

    try {
      // Create Lightning invoice
      const invoice = await voltageClient.createInvoice(
        amountSats,
        `BTC to ZMW exchange: ${req.amount_zmw} ZMW`
      );

      // Create transaction record
      const transaction = await exchangeDB.queryRow<{ id: string }>`
        INSERT INTO transactions (
          type, amount_zmw, amount_sats, exchange_rate, 
          recipient_info, lightning_invoice, voltage_invoice_id
        )
        VALUES (
          'btc_to_zmw', ${req.amount_zmw}, ${amountSats}, ${rate},
          ${JSON.stringify(req.recipient_info)}, ${invoice.payment_request}, ${invoice.id}
        )
        RETURNING id
      `;

      return {
        transaction_id: transaction!.id,
        lightning_invoice: invoice.payment_request,
        amount_sats: amountSats,
        exchange_rate: rate,
        expires_at: invoice.expires_at,
      };
    } catch (error) {
      // Release reserved liquidity on error
      await liquidityService.releaseLiquidity("ZMW", req.amount_zmw);
      throw error;
    }
  }
);
