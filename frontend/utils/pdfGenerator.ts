// Simple PDF generation without problematic dependencies
import type { Transaction } from '~backend/exchange/types';

interface PDFGenerationData {
  transaction: Transaction;
  exchangeRate: number;
  recipientInfo?: {
    phone?: string;
    lightning_address?: string;
    lightning_invoice?: string;
  };
  senderInfo?: {
    phone?: string;
  };
}

export async function generateReceiptPDF(data: PDFGenerationData): Promise<void> {
  const { transaction, exchangeRate, recipientInfo, senderInfo } = data;
  
  // Helper functions
  const formatCurrency = (value: number, currency: 'ZMW' | 'BTC') => {
    if (currency === 'ZMW') {
      return new Intl.NumberFormat('en-ZM', {
        style: 'currency',
        currency: 'ZMW',
        minimumFractionDigits: 2,
      }).format(value);
    } else {
      return `${value.toFixed(8)} BTC`;
    }
  };

  const formatSats = (sats: number) => {
    return new Intl.NumberFormat().format(sats);
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat('en-ZM', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short',
    }).format(date);
  };

  const getRecipientDisplay = () => {
    if (transaction.type === 'btc_to_zmw') {
      return recipientInfo?.phone || 'Mobile Money';
    } else {
      const lightning = recipientInfo?.lightning_address || recipientInfo?.lightning_invoice;
      if (lightning && lightning.length > 30) {
        return `${lightning.slice(0, 15)}...${lightning.slice(-10)}`;
      }
      return lightning || 'Lightning Address';
    }
  };

  const getSenderDisplay = () => {
    if (transaction.type === 'zmw_to_btc') {
      return senderInfo?.phone || 'Mobile Money';
    }
    return 'Lightning Network';
  };

  const getTransactionTitle = () => {
    return transaction.type === 'btc_to_zmw' 
      ? 'Bitcoin → Kwacha Exchange'
      : 'Kwacha → Bitcoin Exchange';
  };

  // Create HTML content for the receipt
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Transaction Receipt</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          margin: 0;
          padding: 20px;
          color: #1f2937;
          line-height: 1.5;
        }
        .header {
          background: linear-gradient(135deg, #f97316, #ea580c);
          color: white;
          padding: 20px;
          margin: -20px -20px 20px -20px;
          text-align: center;
        }
        .header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: bold;
        }
        .header p {
          margin: 5px 0 0 0;
          font-size: 14px;
          opacity: 0.9;
        }
        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: bold;
          text-transform: uppercase;
          background: ${transaction.status === 'completed' ? '#22c55e' : '#ef4444'};
          color: white;
          margin: 10px 0;
        }
        .section {
          margin: 20px 0;
          padding: 15px;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
        }
        .section-title {
          font-size: 16px;
          font-weight: bold;
          color: #f97316;
          margin: 0 0 15px 0;
          padding-bottom: 8px;
          border-bottom: 2px solid #f97316;
        }
        .detail-row {
          display: flex;
          justify-content: space-between;
          margin: 8px 0;
          padding: 4px 0;
        }
        .detail-label {
          font-weight: 500;
          color: #6b7280;
        }
        .detail-value {
          font-weight: 600;
          text-align: right;
        }
        .total-row {
          border-top: 2px solid #e5e7eb;
          margin-top: 15px;
          padding-top: 15px;
          font-size: 18px;
          font-weight: bold;
        }
        .grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
          margin: 15px 0;
        }
        .footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e5e7eb;
          text-align: center;
          font-size: 12px;
          color: #6b7280;
        }
        .mono {
          font-family: 'Courier New', monospace;
          font-size: 11px;
        }
        @media print {
          body { margin: 0; }
          .header { margin: -20px -20px 20px -20px; }
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>NTUMBA</h1>
        <p>Transaction Receipt</p>
        <div class="status-badge">${transaction.status}</div>
      </div>

      <div class="section">
        <div class="section-title">TRANSACTION DETAILS</div>
        <div class="detail-row">
          <span class="detail-label">Transaction ID:</span>
          <span class="detail-value mono">${transaction.id}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Date & Time:</span>
          <span class="detail-value">${formatDate(new Date(transaction.created_at))}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Type:</span>
          <span class="detail-value">${getTransactionTitle()}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Exchange Rate:</span>
          <span class="detail-value">${formatCurrency(exchangeRate, 'ZMW')} per BTC</span>
        </div>
        ${transaction.completed_at ? `
        <div class="detail-row">
          <span class="detail-label">Completed At:</span>
          <span class="detail-value">${formatDate(new Date(transaction.completed_at))}</span>
        </div>
        ` : ''}
      </div>

      <div class="section">
        <div class="section-title">AMOUNT BREAKDOWN</div>
        <div class="detail-row">
          <span class="detail-label">Amount:</span>
          <div class="detail-value">
            <div>${formatCurrency(transaction.amount_zmw, 'ZMW')}</div>
            <div style="font-size: 12px; color: #6b7280;">≈ ${formatCurrency(transaction.amount_sats / 100000000, 'BTC')}</div>
          </div>
        </div>
        <div class="detail-row">
          <span class="detail-label">Service Fee:</span>
          <div class="detail-value">
            <div>${formatCurrency(transaction.fee_zmw, 'ZMW')}</div>
            <div style="font-size: 12px; color: #6b7280;">≈ ${formatCurrency(transaction.fee_sats / 100000000, 'BTC')}</div>
          </div>
        </div>
        <div class="detail-row total-row">
          <span class="detail-label">TOTAL:</span>
          <div class="detail-value">
            <div>${formatCurrency(transaction.total_zmw, 'ZMW')}</div>
            <div style="font-size: 14px; color: #6b7280;">≈ ${formatCurrency(transaction.total_sats / 100000000, 'BTC')}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">PARTICIPANT DETAILS</div>
        <div class="grid">
          <div>
            <div class="detail-label">${transaction.type === 'btc_to_zmw' ? 'From (Lightning):' : 'From (Mobile Money):'}</div>
            <div class="detail-value" style="margin-top: 5px;">${getSenderDisplay()}</div>
          </div>
          <div>
            <div class="detail-label">${transaction.type === 'btc_to_zmw' ? 'To (Mobile Money):' : 'To (Lightning):'}</div>
            <div class="detail-value" style="margin-top: 5px; word-break: break-all;">${getRecipientDisplay()}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <div class="section-title">TECHNICAL DETAILS</div>
        <div class="detail-row">
          <span class="detail-label">Amount (Satoshis):</span>
          <span class="detail-value mono">${formatSats(transaction.amount_sats)} sats</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Fee (Satoshis):</span>
          <span class="detail-value mono">${formatSats(transaction.fee_sats)} sats</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Total (Satoshis):</span>
          <span class="detail-value mono">${formatSats(transaction.total_sats)} sats</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Transaction Type:</span>
          <span class="detail-value">${transaction.type === 'btc_to_zmw' ? 'Bitcoin to Kwacha' : 'Kwacha to Bitcoin'}</span>
        </div>
      </div>

      <div class="footer">
        <p>This receipt serves as proof of your transaction. Please keep it for your records.</p>
        <p>Generated by Ntumba Exchange Platform</p>
        <p>Generated on ${formatDate(new Date())}</p>
      </div>
    </body>
    </html>
  `;

  // Create a new window/tab with the receipt content
  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    throw new Error('Unable to open print window. Please allow popups for this site.');
  }

  printWindow.document.write(htmlContent);
  printWindow.document.close();

  // Wait for content to load, then trigger print dialog
  printWindow.onload = () => {
    setTimeout(() => {
      printWindow.print();
      
      // Close the window after printing (optional)
      printWindow.onafterprint = () => {
        printWindow.close();
      };
    }, 500);
  };

  // Generate filename for reference
  const dateStr = new Date().toISOString().split('T')[0];
  const transactionShort = transaction.id.slice(0, 8);
  const filename = `ntumba-receipt-${transactionShort}-${dateStr}`;
  
  console.log(`Receipt generated: ${filename}`);
}
