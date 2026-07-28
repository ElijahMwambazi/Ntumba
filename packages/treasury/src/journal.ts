import { randomUUID } from "node:crypto";
import type { TreasuryJournal, TreasuryJournalTransaction } from "./types.js";

export class InMemoryTreasuryJournal implements TreasuryJournal {
  readonly #byIdempotencyKey = new Map<string, TreasuryJournalTransaction>();
  readonly #transactions: TreasuryJournalTransaction[] = [];

  append(
    input: Omit<TreasuryJournalTransaction, "id"> & { id?: string },
  ): TreasuryJournalTransaction {
    const existing = this.#byIdempotencyKey.get(input.idempotencyKey);
    if (existing) {
      const sameEntries =
        existing.entries.length === input.entries.length &&
        existing.entries.every((entry, index) => {
          const candidate = input.entries[index];
          return (
            candidate !== undefined &&
            entry.account === candidate.account &&
            entry.amount === candidate.amount &&
            entry.side === candidate.side
          );
        });
      if (
        existing.asset !== input.asset ||
        existing.exchangeGroupId !== input.exchangeGroupId ||
        existing.kind !== input.kind ||
        existing.opaqueReference !== input.opaqueReference ||
        !sameEntries
      ) {
        throw new Error("Journal idempotency conflict.");
      }
      return existing;
    }
    if (input.entries.length < 2) {
      throw new Error("A journal transaction requires debit and credit entries.");
    }
    let debits = 0n;
    let credits = 0n;
    for (const entry of input.entries) {
      if (entry.amount <= 0n) {
        throw new Error("Journal amounts must be positive integers.");
      }
      if (entry.side === "debit") {
        debits += entry.amount;
      } else {
        credits += entry.amount;
      }
    }
    if (debits !== credits) {
      throw new Error(`Journal transaction is not balanced for ${input.asset}.`);
    }
    const transaction: TreasuryJournalTransaction = Object.freeze({
      ...input,
      entries: Object.freeze(input.entries.map((entry) => Object.freeze({ ...entry }))),
      id: input.id ?? randomUUID(),
    });
    this.#transactions.push(transaction);
    this.#byIdempotencyKey.set(transaction.idempotencyKey, transaction);
    return transaction;
  }

  entries(): readonly TreasuryJournalTransaction[] {
    return Object.freeze([...this.#transactions]);
  }
}
