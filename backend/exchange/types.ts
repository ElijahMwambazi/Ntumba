export interface Transaction {
  id: string;
  type: 'btc_to_zmw' | 'zmw_to_btc';
  status: 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
  amount_zmw: number;
  amount_sats: number;
  exchange_rate: number;
  fee_zmw: number;
  fee_sats: number;
  total_zmw: number;
  total_sats: number;
  sender_info?: any;
  recipient_info: any;
  lightning_invoice?: string;
  lightning_payment_hash?: string;
  lipila_transaction_id?: string;
  voltage_invoice_id?: string;
  created_at: Date;
  updated_at: Date;
  completed_at?: Date;
}

export interface ExchangeRate {
  id: number;
  btc_zmw_rate: number;
  source: string;
  timestamp: Date;
}

export interface LiquidityPool {
  id: number;
  currency: string;
  balance: number;
  reserved: number;
  updated_at: Date;
}

export interface RecipientInfo {
  phone?: string;
  bank_account?: string;
  lightning_address?: string;
  lightning_invoice?: string;
}

export interface VoltageInvoice {
  id: string;
  payment_request: string;
  payment_hash: string;
  amount: number;
  status: string;
  expires_at: string;
}

export interface LipilaPayout {
  transaction_id: string;
  amount: number;
  recipient: string;
  status: string;
  reference: string;
}

export interface FeeCalculation {
  amount_zmw: number;
  amount_sats: number;
  fee_zmw: number;
  fee_sats: number;
  total_zmw: number;
  total_sats: number;
  fee_percentage: number;
}
