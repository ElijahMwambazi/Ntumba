import { exchangeRateService } from "./exchange_rate_service";

export class FeeService {
  // Fee configuration
  private readonly BASE_FEE_PERCENTAGE = 0.015; // 1.5%
  private readonly MIN_FEE_ZMW = 5; // Minimum 5 ZMW fee
  private readonly MAX_FEE_ZMW = 500; // Maximum 500 ZMW fee

  async calculateFees(amountZmw: number, exchangeRate: number): Promise<{
    amount_zmw: number;
    amount_sats: number;
    fee_zmw: number;
    fee_sats: number;
    total_zmw: number;
    total_sats: number;
    fee_percentage: number;
  }> {
    // Calculate base fee
    let feeZmw = Math.max(amountZmw * this.BASE_FEE_PERCENTAGE, this.MIN_FEE_ZMW);
    feeZmw = Math.min(feeZmw, this.MAX_FEE_ZMW);
    
    // Round fee to 2 decimal places
    feeZmw = Math.round(feeZmw * 100) / 100;
    
    const totalZmw = amountZmw + feeZmw;
    
    // Convert to sats
    const amountSats = exchangeRateService.zmwToSats(amountZmw, exchangeRate);
    const feeSats = exchangeRateService.zmwToSats(feeZmw, exchangeRate);
    const totalSats = amountSats + feeSats;
    
    const actualFeePercentage = (feeZmw / amountZmw) * 100;

    return {
      amount_zmw: amountZmw,
      amount_sats: amountSats,
      fee_zmw: feeZmw,
      fee_sats: feeSats,
      total_zmw: totalZmw,
      total_sats: totalSats,
      fee_percentage: actualFeePercentage,
    };
  }

  getEstimatedDeliveryTime(transactionType: 'btc_to_zmw' | 'zmw_to_btc'): string {
    switch (transactionType) {
      case 'btc_to_zmw':
        return 'Funds arrive within 5-10 minutes after Lightning payment';
      case 'zmw_to_btc':
        return 'Bitcoin sent instantly after mobile money confirmation';
      default:
        return 'Processing time varies';
    }
  }
}

export const feeService = new FeeService();
