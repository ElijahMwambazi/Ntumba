CREATE TABLE transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(20) NOT NULL CHECK (type IN ('btc_to_zmw', 'zmw_to_btc')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  amount_zmw DOUBLE PRECISION NOT NULL,
  amount_sats BIGINT NOT NULL,
  exchange_rate DOUBLE PRECISION NOT NULL,
  sender_info JSONB,
  recipient_info JSONB NOT NULL,
  lightning_invoice TEXT,
  lightning_payment_hash TEXT,
  lipila_transaction_id TEXT,
  voltage_invoice_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE exchange_rates (
  id BIGSERIAL PRIMARY KEY,
  btc_zmw_rate DOUBLE PRECISION NOT NULL,
  source VARCHAR(50) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE liquidity_pools (
  id BIGSERIAL PRIMARY KEY,
  currency VARCHAR(10) NOT NULL UNIQUE,
  balance DOUBLE PRECISION NOT NULL DEFAULT 0,
  reserved DOUBLE PRECISION NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Initialize liquidity pools
INSERT INTO liquidity_pools (currency, balance) VALUES 
('BTC', 0.0),
('ZMW', 0.0);

CREATE INDEX idx_transactions_status ON transactions(status);
CREATE INDEX idx_transactions_type ON transactions(type);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
CREATE INDEX idx_exchange_rates_timestamp ON exchange_rates(timestamp);
