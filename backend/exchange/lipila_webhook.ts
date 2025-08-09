import { api } from "encore.dev/api";
import { exchangeDB } from "./db";
import { liquidityService } from "./liquidity_service";
import { voltageClient } from "./voltage_client";

interface LilipaWebhookRequest {
  event: string;
  transaction_id: string;
  amount: number;
  status: string;
  reference: string;
}

// Handles webhooks from Lilipa for mobile money payment updates.
export const lilipaWebhook = api<LilipaWebhookRequest, void>(
  { expose: true, method: "POST", path: "/webhooks/lipila" },
  async (req) => {
    if (req.event === "transaction.completed") {
      await handleTransactionCompleted(req);
    } else if (req.event === "transaction.failed") {
      await handleTransactionFailed(req);
    }
  }
);

async function handleTransactionCompleted(webhook: LilipaWebhookRequest) {
  // Find the transaction
  const transaction = await exchangeDB.queryRow<{
    id: string;
    type: string;
    amount_sats: number;
    recipient_info: any;
  }>`
    SELECT id, type, amount_sats, recipient_info
    FROM transactions 
    WHERE lipila_transaction_id = ${webhook.transaction_id}
    AND status IN ('pending', 'processing')
  `;

  if (!transaction) {
    console.log(`No pending transaction found for Lilipa transaction ${webhook.transaction_id}`);
    return;
  }

  try {
    if (transaction.type === "zmw_to_btc") {
      // ZMW collection completed, now send BTC
      const recipientInfo = transaction.recipient_info;
      
      if (recipientInfo.lightning_invoice) {
        // Pay the provided invoice
        const payment = await voltageClient.payInvoice(recipientInfo.lightning_invoice);
        
        await exchangeDB.exec`
          UPDATE transactions 
          SET lightning_payment_hash = ${payment.payment_hash},
              status = 'completed',
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = ${transaction.id}
        `;
      } else {
        // For lightning address, we'd need to resolve it first
        // This is a simplified implementation
        await exchangeDB.exec`
          UPDATE transactions 
          SET status = 'completed',
              completed_at = NOW(),
              updated_at = NOW()
          WHERE id = ${transaction.id}
        `;
      }

      // Consume reserved BTC liquidity
      const btcAmount = transaction.amount_sats / 100000000;
      await liquidityService.consumeLiquidity("BTC", btcAmount);
      
      // Add ZMW to liquidity pool
      await liquidityService.addLiquidity("ZMW", webhook.amount);
    }
  } catch (error) {
    console.error(`Failed to process completed Lilipa transaction ${webhook.transaction_id}:`, error);
    
    // Mark transaction as failed
    await exchangeDB.exec`
      UPDATE transactions 
      SET status = 'failed', updated_at = NOW()
      WHERE id = ${transaction.id}
    `;
  }
}

async function handleTransactionFailed(webhook: LilipaWebhookRequest) {
  // Find and mark transaction as failed
  const transaction = await exchangeDB.queryRow<{
    id: string;
    type: string;
    amount_zmw: number;
    amount_sats: number;
  }>`
    SELECT id, type, amount_zmw, amount_sats
    FROM transactions 
    WHERE lipila_transaction_id = ${webhook.transaction_id}
  `;

  if (!transaction) {
    return;
  }

  await exchangeDB.exec`
    UPDATE transactions 
    SET status = 'failed', updated_at = NOW()
    WHERE id = ${transaction.id}
  `;

  // Release reserved liquidity
  if (transaction.type === "btc_to_zmw") {
    await liquidityService.releaseLiquidity("ZMW", transaction.amount_zmw);
  } else if (transaction.type === "zmw_to_btc") {
    const btcAmount = transaction.amount_sats / 100000000;
    await liquidityService.releaseLiquidity("BTC", btcAmount);
  }
}
