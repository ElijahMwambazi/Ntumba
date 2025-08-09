import { api } from "encore.dev/api";
import { liquidityService } from "./liquidity_service";

interface LiquidityStatusResponse {
  pools: Array<{
    currency: string;
    balance: number;
    reserved: number;
    available: number;
  }>;
}

// Gets the current liquidity status for all pools.
export const getLiquidityStatus = api<void, LiquidityStatusResponse>(
  { expose: true, method: "GET", path: "/exchange/liquidity" },
  async () => {
    const pools = await liquidityService.getLiquidityStatus();
    
    return {
      pools: pools.map(pool => ({
        currency: pool.currency,
        balance: pool.balance,
        reserved: pool.reserved,
        available: pool.balance - pool.reserved,
      })),
    };
  }
);
