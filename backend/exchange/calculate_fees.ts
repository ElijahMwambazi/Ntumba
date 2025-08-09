import { api, APIError } from "encore.dev/api";
import { exchangeRateService } from "./exchange_rate_service";
import { feeService } from "./fee_service";

interface CalculateFeesRequest {
  amount_zmw: number;
  transaction_type: 'btc_to_zmw' | 'zmw_to_btc';
}

interface CalculateFeesResponse {
  amount_zmw: number;
  amount_sats: number;
  fee_zmw: number;
  fee_sats: number;
  total_zmw: number;
  total_sats: number;
  fee_percentage: number;
  exchange_rate: number;
  estimated_delivery_time: string;
}

// Calculates fees and totals for a transaction amount.
export const calculateFees = api<CalculateFeesRequest, CalculateFeesResponse>(
  { expose: true, method: "POST", path: "/exchange/calculate-fees" },
  async (req) => {
    if (req.amount_zmw <= 0) {
      throw APIError.invalidArgument("Amount must be positive");
    }

    if (!['btc_to_zmw', 'zmw_to_btc'].includes(req.transaction_type)) {
      throw APIError.invalidArgument("Invalid transaction type");
    }

    // Get current exchange rate
    const exchangeRate = await exchangeRateService.getCurrentRate();

    // Calculate fees
    const feeCalculation = await feeService.calculateFees(req.amount_zmw, exchangeRate);

    // Get estimated delivery time
    const estimatedDeliveryTime = feeService.getEstimatedDeliveryTime(req.transaction_type);

    return {
      ...feeCalculation,
      exchange_rate: exchangeRate,
      estimated_delivery_time: estimatedDeliveryTime,
    };
  }
);
