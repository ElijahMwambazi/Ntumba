import { exchangeDB } from "./db";
import { APIError } from "encore.dev/api";

export class LiquidityService {
  async checkAvailability(currency: string, amount: number): Promise<boolean> {
    const pool = await exchangeDB.queryRow<{ balance: number, reserved: number }>`
      SELECT balance, reserved 
      FROM liquidity_pools 
      WHERE currency = ${currency}
    `;

    if (!pool) {
      throw APIError.notFound(`Liquidity pool for ${currency} not found`);
    }

    const available = pool.balance - pool.reserved;
    return available >= amount;
  }

  async reserveLiquidity(currency: string, amount: number): Promise<void> {
    const result = await exchangeDB.exec`
      UPDATE liquidity_pools 
      SET reserved = reserved + ${amount}
      WHERE currency = ${currency} 
      AND (balance - reserved) >= ${amount}
    `;

    // Note: In a real implementation, you'd check if the update affected any rows
  }

  async releaseLiquidity(currency: string, amount: number): Promise<void> {
    await exchangeDB.exec`
      UPDATE liquidity_pools 
      SET reserved = reserved - ${amount}
      WHERE currency = ${currency}
    `;
  }

  async consumeLiquidity(currency: string, amount: number): Promise<void> {
    await exchangeDB.exec`
      UPDATE liquidity_pools 
      SET balance = balance - ${amount}, reserved = reserved - ${amount}
      WHERE currency = ${currency}
    `;
  }

  async addLiquidity(currency: string, amount: number): Promise<void> {
    await exchangeDB.exec`
      UPDATE liquidity_pools 
      SET balance = balance + ${amount}
      WHERE currency = ${currency}
    `;
  }

  async getLiquidityStatus() {
    return exchangeDB.queryAll<{ currency: string, balance: number, reserved: number }>`
      SELECT currency, balance, reserved 
      FROM liquidity_pools
    `;
  }
}

export const liquidityService = new LiquidityService();
