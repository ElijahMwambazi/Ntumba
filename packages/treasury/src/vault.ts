import { randomUUID } from "node:crypto";
import type { SettlementDestination } from "@ntumba/contracts";
import type { SettlementDestinationVault } from "./types.js";

interface VaultEntry {
  destination: SettlementDestination;
  expiresAt: Date;
}

export class InMemorySettlementDestinationVault implements SettlementDestinationVault {
  readonly developmentOnly = true as const;
  readonly #entries = new Map<string, VaultEntry>();
  readonly #tokenFactory: () => string;

  constructor(tokenFactory: () => string = randomUUID) {
    this.#tokenFactory = tokenFactory;
  }

  put(destination: SettlementDestination, expiresAt: Date): string {
    if (expiresAt.getTime() <= Date.now()) {
      throw new Error("Settlement destination expiry must be in the future.");
    }
    const token = this.#tokenFactory();
    this.#entries.set(token, { destination: structuredClone(destination), expiresAt });
    return token;
  }

  read(token: string, now: Date): SettlementDestination | null {
    const entry = this.#entries.get(token);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt.getTime() <= now.getTime()) {
      this.#entries.delete(token);
      return null;
    }
    return structuredClone(entry.destination);
  }

  delete(token: string): void {
    this.#entries.delete(token);
  }

  purgeExpired(now: Date): number {
    let purged = 0;
    for (const [token, entry] of this.#entries) {
      if (entry.expiresAt.getTime() <= now.getTime()) {
        this.#entries.delete(token);
        purged += 1;
      }
    }
    return purged;
  }
}
