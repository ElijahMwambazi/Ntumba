import type { LiquidityInventoryService, LiquidityReservation, TreasuryAsset } from "./types.js";

function positiveInteger(value: bigint, label: string): void {
  if (value <= 0n) {
    throw new Error(`${label} must be a positive integer amount.`);
  }
}

export class InMemoryLiquidityInventory implements LiquidityInventoryService {
  readonly #available = new Map<TreasuryAsset, bigint>();
  readonly #reservations = new Map<string, LiquidityReservation>();

  constructor(initial: { BTC: bigint; ZMW: bigint }) {
    if (initial.BTC < 0n || initial.ZMW < 0n) {
      throw new Error("Initial liquidity cannot be negative.");
    }
    this.#available.set("BTC", initial.BTC);
    this.#available.set("ZMW", initial.ZMW);
  }

  available(asset: TreasuryAsset): bigint {
    return this.#available.get(asset) ?? 0n;
  }

  reserved(asset: TreasuryAsset): bigint {
    let total = 0n;
    for (const reservation of this.#reservations.values()) {
      if (reservation.asset === asset) {
        total += reservation.amount;
      }
    }
    return total;
  }

  reserve(input: {
    amount: bigint;
    asset: TreasuryAsset;
    reservationId: string;
  }): LiquidityReservation | null {
    positiveInteger(input.amount, "Reservation");
    const existing = this.#reservations.get(input.reservationId);
    if (existing) {
      if (existing.amount !== input.amount || existing.asset !== input.asset) {
        throw new Error("Reservation idempotency conflict.");
      }
      return existing;
    }
    if (this.available(input.asset) - this.reserved(input.asset) < input.amount) {
      return null;
    }
    const reservation = {
      amount: input.amount,
      asset: input.asset,
      id: input.reservationId,
    };
    this.#reservations.set(input.reservationId, reservation);
    return reservation;
  }

  commit(reservationId: string): void {
    const reservation = this.#reservations.get(reservationId);
    if (!reservation) {
      throw new Error("Liquidity reservation is unavailable.");
    }
    this.#available.set(reservation.asset, this.available(reservation.asset) - reservation.amount);
    this.#reservations.delete(reservationId);
  }

  release(reservationId: string): void {
    this.#reservations.delete(reservationId);
  }

  credit(asset: TreasuryAsset, amount: bigint): void {
    positiveInteger(amount, "Liquidity credit");
    this.#available.set(asset, this.available(asset) + amount);
  }
}
