import type { IntegerRateQuote, RateProvider } from "./types.js";

export class FixedFakeRateProvider implements RateProvider {
  readonly #rate: bigint;
  readonly #ttlMilliseconds: number;

  constructor(rateZmwMinorPerBitcoin: bigint, ttlSeconds = 60) {
    if (rateZmwMinorPerBitcoin <= 0n || !Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
      throw new Error("Fake rate configuration must be positive.");
    }
    this.#rate = rateZmwMinorPerBitcoin;
    this.#ttlMilliseconds = ttlSeconds * 1_000;
  }

  async readRate(now: Date): Promise<IntegerRateQuote> {
    return {
      expiresAt: new Date(now.getTime() + this.#ttlMilliseconds),
      rateZmwMinorPerBitcoin: this.#rate,
    };
  }
}
