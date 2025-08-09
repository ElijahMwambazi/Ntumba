import { api } from "encore.dev/api";
import { exchangeDB } from "./db";
import { liquidityService } from "./liquidity_service";
import { lilipaClient } from "./lipila_client";

interface VoltageWebhookRequest {
  event: string;
  invoice_id: string;
  payment_hash: string;
  amount: number;
  status: string;
}

// Handles webhooks from Voltage for Lightning payment updates.
export const voltageWebhook = api<VoltageWebhookRequest, void>(
  { expose: true, method: "POST", path: "/webhooks/voltage" },
  async (req) => {
    if (req.event === "invoice.paid") {
      await handleInvoicePaid(req);
    }
  }
);

async function handleInvoicePaid(webhook: VoltageWebhookRequest) {
  // Find the transaction
  const transaction = await exchangeDB.queryRow<{
    id: string;
    type: string;
    amount_zmw: number;
    recipient_info: any;
  }>`
    SELECT id, type, amount_zmw, recipient_info
    FROM transactions 
    WHERE voltage_invoice_id = ${webhook.invoice_id}
    AND status = 'pending'
  `;

  if (!transaction) {
    console.log(`No pending transaction found for invoice ${webhook.invoice_id}`);
    return;
  }

  try {
    // Update transaction status
    await exchangeDB.exec`
      UPDATE transactions 
      SET status = 'processing', 
          lightning_payment_hash = ${webhook.payment_hash},
          updated_at = NOW()
      WHERE id = ${transaction.id}
    `;

    if (transaction.type === "btc_to_zmw") {
      // Send ZMW to recipient
      const recipientInfo = transaction.recipient_info;
      const recipient = recipientInfo.phone || recipientInfo.bank_account;
      
      const payout = await lilipaClient.sendPayout(
        transaction.amount_zmw,
        recipient,
        `BTC-ZMW-${transaction.id}`
      );

      // Update transaction with Lilipa reference
      await exchangeDB.exec`
        UPDATE transactions 
        SET lipila_transaction_id = ${payout.transaction_id},
            status = 'completed',
            completed_at = NOW(),
            updated_at = NOW()
        WHERE id = ${transaction.id}
      `;

      // Consume reserved ZMW liquidity
      await liquidityService.consumeLiquidity("ZMW", transaction.amount_zmw);
    }
  } catch (error) {
    console.error(`Failed to process paid invoice ${webhook.invoice_id}:`, error);
    
    // Mark transaction as failed
    await exchangeDB.exec`
      UPDATE transactions 
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${transaction.id}
    `;

    // Release reserved liquidity
    if (transaction.type === "btc_to_zmw") {
      await liquidityService.releaseLiquidity("ZMW", transaction.amount_zmw);
    }
  }
}
