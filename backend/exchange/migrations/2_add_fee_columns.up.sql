ALTER TABLE transactions 
ADD COLUMN fee_zmw DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN fee_sats BIGINT NOT NULL DEFAULT 0,
ADD COLUMN total_zmw DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN total_sats BIGINT NOT NULL DEFAULT 0;

-- Update existing transactions to have fee columns populated
UPDATE transactions 
SET fee_zmw = 0, fee_sats = 0, total_zmw = amount_zmw, total_sats = amount_sats
WHERE fee_zmw = 0;
