import { api, APIError } from "encore.dev/api";
import { exchangeDB } from "./db";
import { exchangeRateService } from "./exchange_rate_service";
import { liquidityService } from "./liquidity_service";
import { lilipaClient } from "./lipila_client";
import { feeService } from "./fee_service";
import type { RecipientInfo } from "./types";

interface CreateZmwToBtcRequest {
  amount_zmw: number;
  sender_phone: string;
  recipient_info: RecipientInfo;
}

interface CreateZmwToBtcResponse {
  transaction_id: string;
  amount_sats: number;
  fee_sats: number;
  total_sats: number;
  exchange_rate: number;
  collection_reference: string;
}

// Creates a new ZMW to BTC transaction.
export const createZmwToBtc = api<CreateZmwToBtcRequest, CreateZmwToBtcResponse>(
  { expose: true, method: "POST", path: "/exchange/zmw-to-btc" },
  async (req) => {
    if (req.amount_zmw <= 0) {
      throw APIError.invalidArgument("Amount must be positive");
    }

    if (!req.recipient_info.lightning_address && !req.recipient_info.lightning_invoice) {
      throw APIError.invalidArgument("Recipient Lightning address or invoice required");
    }

    // Get current exchange rate
    const rate = await exchangeRateService.getCurrentRate();
    
    // Calculate fees
    const feeCalculation = await feeService.calculateFees(req.amount_zmw, rate);

    // Check BTC liquidity availability (for the amount without fees)
    const btcAmount = feeCalculation.amount_sats / 100000000;
    const hasLiquidity = await liquidityService.checkAvailability("BTC", btcAmount);
    if (!hasLiquidity) {
      throw APIError.resourceExhausted("Insufficient BTC liquidity");
    }

    // Reserve BTC liquidity
    await liquidityService.reserveLiquidity("BTC", btcAmount);

    try {
      // Create transaction record
      const transaction = await exchangeDB.queryRow<{ id: string }>`
        INSERT INTO transactions (
          type, amount_zmw, amount_sats, fee_zmw, fee_sats,
          total_zmw, total_sats, exchange_rate,
          sender_info, recipient_info
        )
        VALUES (
          'zmw_to_btc', ${req.amount_zmw}, ${feeCalculation.amount_sats},
          ${feeCalculation.fee_zmw}, ${feeCalculation.fee_sats},
          ${feeCalculation.total_zmw}, ${feeCalculation.total_sats}, ${rate},
          ${JSON.stringify({ phone: req.sender_phone })}, ${JSON.stringify(req.recipient_info)}
        )
        RETURNING id
      `;

      const transactionId = transaction!.id;

      // Initiate ZMW collection for the total amount (including fees)
      const collection = await lilipaClient.collectDeposit(
        feeCalculation.total_zmw,
        req.sender_phone,
        `ZMW-BTC-${transactionId}`
      );

      // Update transaction with Lilipa reference
      await exchangeDB.exec`
        UPDATE transactions 
        SET lipila_transaction_id = ${collection.transaction_id}
        WHERE id = ${transactionId}
      `;

      return {
        transaction_id: transactionId,
        amount_sats: feeCalculation.amount_sats,
        fee_sats: feeCalculation.fee_sats,
        total_sats: feeCalculation.total_sats,
        exchange_rate: rate,
        collection_reference: collection.reference,
      };
    } catch (error) {
      // Release reserved liquidity on error
      await liquidityService.releaseLiquidity("BTC", btcAmount);
      throw error;
    }
  }
);
