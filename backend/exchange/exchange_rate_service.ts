import { exchangeDB } from "./db";

export class ExchangeRateService {
  async getCurrentRate(): Promise<number> {
    // Try to get the latest rate from our database
    const latestRate = await exchangeDB.queryRow<{ btc_zmw_rate: number }>`
      SELECT btc_zmw_rate 
      FROM exchange_rates 
      ORDER BY timestamp DESC 
      LIMIT 1
    `;

    if (latestRate && this.isRateRecent(latestRate)) {
      return latestRate.btc_zmw_rate;
    }

    // Fetch fresh rate from external API
    return this.fetchAndStoreRate();
  }

  private async fetchAndStoreRate(): Promise<number> {
    try {
      // Using a mock rate for demo - replace with actual API call
      // Example: Binance API, CoinGecko, etc.
      const mockRate = 1500000; // 1 BTC = 1,500,000 ZMW
      
      await exchangeDB.exec`
        INSERT INTO exchange_rates (btc_zmw_rate, source)
        VALUES (${mockRate}, 'mock_api')
      `;

      return mockRate;
    } catch (error) {
      console.error('Failed to fetch exchange rate:', error);
      // Return a fallback rate
      return 1500000;
    }
  }

  private isRateRecent(rate: any): boolean {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    return new Date(rate.timestamp) > fiveMinutesAgo;
  }

  satsToZmw(sats: number, rate: number): number {
    return (sats / 100000000) * rate;
  }

  zmwToSats(zmw: number, rate: number): number {
    return Math.floor((zmw / rate) * 100000000);
  }
}

export const exchangeRateService = new ExchangeRateService();
