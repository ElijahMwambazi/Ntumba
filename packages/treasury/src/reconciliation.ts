import type { BridgeSettlement, ReconciliationResult, ReconciliationService } from "./types.js";

export class DeterministicFakeReconciliationService implements ReconciliationService {
  readonly #outcome: ReconciliationResult["outcome"];

  constructor(outcome: ReconciliationResult["outcome"] = "matched") {
    this.#outcome = outcome;
  }

  async reconcile(_settlement: BridgeSettlement, now: Date): Promise<ReconciliationResult> {
    return {
      checkedAt: now,
      outcome: this.#outcome,
      safeCode: this.#outcome === "matched" ? null : "FAKE_RECONCILIATION_DIFFERENCE",
    };
  }
}
