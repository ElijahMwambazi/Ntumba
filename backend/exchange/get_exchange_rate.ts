import { api } from "encore.dev/api";
import { exchangeRateService } from "./exchange_rate_service";

interface ExchangeRateResponse {
  btc_zmw_rate: number;
  timestamp: Date;
}

// Gets the current BTC to ZMW exchange rate.
export const getExchangeRate = api<void, ExchangeRateResponse>(
  { expose: true, method: "GET", path: "/exchange/rate" },
  async () => {
    const rate = await exchangeRateService.getCurrentRate();
    return {
      btc_zmw_rate: rate,
      timestamp: new Date(),
    };
  }
);
