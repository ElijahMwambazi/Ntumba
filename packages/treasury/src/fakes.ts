import { createHash } from "node:crypto";
import type {
  BitcoinLiquidityRail,
  BitcoinTreasuryStatus,
  CollectionState,
  ExternalOutcome,
  InvoiceState,
  MobileMoneyLiquidityRail,
  MobileMoneyTreasuryStatus,
  RailResult,
} from "./types.js";

type BitcoinOperation = "create_invoice" | "pay_invoice";
type MobileMoneyOperation = "collect" | "disburse";

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function validateAmount(amount: bigint): void {
  if (amount <= 0n) {
    throw new Error("Treasury operation amount must be a positive integer.");
  }
}

export class FakeVoltageLndRemoteState {
  readonly attemptedPaymentIdempotencyKeys: string[] = [];
  readonly createdInvoices = new Map<
    string,
    {
      amountSats: bigint;
      credited: boolean;
      expiresAt: Date;
      lookupReference: string;
      paymentRequest: string;
    }
  >();
  readonly invoiceStates = new Map<string, InvoiceState>();
  readonly nextOutcomes = new Map<BitcoinOperation, ExternalOutcome[]>();
  readonly paidInvoices = new Map<
    string,
    { amountSats: bigint; lookupReference: string; paymentRequestHash: string }
  >();
  readonly uncertainPayments = new Map<
    string,
    { amountSats: bigint; outcome: "timeout" | "unknown"; paymentRequestHash: string }
  >();
  status: BitcoinTreasuryStatus;

  constructor(
    status: BitcoinTreasuryStatus = {
      available: true,
      availableBalanceSats: 5_000_000n,
      inboundCapacitySats: 10_000_000n,
      outboundCapacitySats: 5_000_000n,
    },
  ) {
    this.status = { ...status };
  }
}

export class FakeVoltageLndTreasury implements BitcoinLiquidityRail {
  readonly attemptedPaymentIdempotencyKeys: string[];
  readonly #remote: FakeVoltageLndRemoteState;

  constructor(
    stateOrStatus:
      | FakeVoltageLndRemoteState
      | BitcoinTreasuryStatus = new FakeVoltageLndRemoteState(),
  ) {
    this.#remote =
      stateOrStatus instanceof FakeVoltageLndRemoteState
        ? stateOrStatus
        : new FakeVoltageLndRemoteState(stateOrStatus);
    this.attemptedPaymentIdempotencyKeys = this.#remote.attemptedPaymentIdempotencyKeys;
  }

  queueOutcome(operation: BitcoinOperation, outcome: ExternalOutcome): void {
    const queued = this.#remote.nextOutcomes.get(operation) ?? [];
    queued.push(outcome);
    this.#remote.nextOutcomes.set(operation, queued);
  }

  private outcome(operation: BitcoinOperation): ExternalOutcome {
    const queued = this.#remote.nextOutcomes.get(operation);
    return queued?.shift() ?? "success";
  }

  async createInvoice(input: {
    amountSats: bigint;
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<RailResult<{ expiresAt: Date; lookupReference: string; paymentRequest: string }>> {
    validateAmount(input.amountSats);
    const existing = this.#remote.createdInvoices.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountSats !== input.amountSats ||
        existing.expiresAt.getTime() !== input.expiresAt.getTime()
      ) {
        throw new Error("Fake Lightning invoice idempotency conflict.");
      }
      return { outcome: "success", value: { ...existing } };
    }
    if (!this.#remote.status.available) {
      return { outcome: "failure", value: null };
    }
    const outcome = this.outcome("create_invoice");
    if (outcome !== "success") {
      return { outcome, value: null };
    }
    const suffix = digest(input.idempotencyKey);
    const invoice = {
      amountSats: input.amountSats,
      credited: false,
      expiresAt: input.expiresAt,
      lookupReference: `fake-lnd-invoice-${suffix}`,
      paymentRequest: `lntb${input.amountSats}n1fakevoltage${suffix}`,
    };
    this.#remote.createdInvoices.set(input.idempotencyKey, invoice);
    this.#remote.invoiceStates.set(invoice.lookupReference, "pending");
    return { outcome: "success", value: { ...invoice } };
  }

  async getInvoiceState(lookupReference: string): Promise<InvoiceState> {
    return this.#remote.invoiceStates.get(lookupReference) ?? "unknown";
  }

  setInvoiceState(lookupReference: string, state: InvoiceState): void {
    if (state !== "settled") {
      this.#remote.invoiceStates.set(lookupReference, state);
      return;
    }
    for (const [key, invoice] of this.#remote.createdInvoices) {
      if (invoice.lookupReference === lookupReference && !invoice.credited) {
        if (
          !this.#remote.status.available ||
          this.#remote.status.inboundCapacitySats < invoice.amountSats
        ) {
          this.#remote.invoiceStates.set(lookupReference, "failed");
          return;
        }
        this.#remote.status.availableBalanceSats += invoice.amountSats;
        this.#remote.status.inboundCapacitySats -= invoice.amountSats;
        this.#remote.status.outboundCapacitySats += invoice.amountSats;
        this.#remote.createdInvoices.set(key, { ...invoice, credited: true });
      }
    }
    this.#remote.invoiceStates.set(lookupReference, state);
  }

  async payInvoice(input: {
    amountSats: bigint;
    idempotencyKey: string;
    paymentRequest: string;
  }): Promise<RailResult<{ lookupReference: string }>> {
    validateAmount(input.amountSats);
    this.#remote.attemptedPaymentIdempotencyKeys.push(input.idempotencyKey);
    const existing = this.#remote.paidInvoices.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountSats !== input.amountSats ||
        existing.paymentRequestHash !== digest(input.paymentRequest)
      ) {
        throw new Error("Fake Lightning payment idempotency conflict.");
      }
      return { outcome: "success", value: { lookupReference: existing.lookupReference } };
    }
    const uncertain = this.#remote.uncertainPayments.get(input.idempotencyKey);
    if (uncertain) {
      if (
        uncertain.amountSats !== input.amountSats ||
        uncertain.paymentRequestHash !== digest(input.paymentRequest)
      ) {
        throw new Error("Fake Lightning payment idempotency conflict.");
      }
      return { outcome: uncertain.outcome, value: null };
    }
    const outcome = this.outcome("pay_invoice");
    if (outcome === "timeout" || outcome === "unknown") {
      this.#remote.uncertainPayments.set(input.idempotencyKey, {
        amountSats: input.amountSats,
        outcome,
        paymentRequestHash: digest(input.paymentRequest),
      });
      return { outcome, value: null };
    }
    if (
      outcome !== "success" ||
      !this.#remote.status.available ||
      this.#remote.status.availableBalanceSats < input.amountSats ||
      this.#remote.status.outboundCapacitySats < input.amountSats
    ) {
      return {
        outcome: outcome === "success" ? "failure" : outcome,
        value: null,
      };
    }
    void input.paymentRequest;
    const payment = {
      amountSats: input.amountSats,
      lookupReference: `fake-lnd-payment-${digest(input.idempotencyKey)}`,
      paymentRequestHash: digest(input.paymentRequest),
    };
    this.#remote.paidInvoices.set(input.idempotencyKey, payment);
    this.#remote.status.availableBalanceSats -= input.amountSats;
    this.#remote.status.outboundCapacitySats -= input.amountSats;
    this.#remote.status.inboundCapacitySats += input.amountSats;
    return { outcome: "success", value: { lookupReference: payment.lookupReference } };
  }

  async readStatus(): Promise<BitcoinTreasuryStatus> {
    return { ...this.#remote.status };
  }
}

export class FakeLipilaRemoteState {
  readonly attemptedDisbursementIdempotencyKeys: string[] = [];
  readonly collections = new Map<
    string,
    {
      amountZmwMinor: bigint;
      checkoutUrl: string;
      credited: boolean;
      lookupReference: string;
    }
  >();
  readonly collectionStates = new Map<string, CollectionState>();
  readonly disbursements = new Map<
    string,
    { amountZmwMinor: bigint; destinationHash: string; lookupReference: string }
  >();
  readonly nextOutcomes = new Map<MobileMoneyOperation, ExternalOutcome[]>();
  readonly uncertainDisbursements = new Map<
    string,
    { amountZmwMinor: bigint; destinationHash: string; outcome: "timeout" | "unknown" }
  >();
  status: MobileMoneyTreasuryStatus;

  constructor(
    status: MobileMoneyTreasuryStatus = {
      available: true,
      availableBalanceZmwMinor: 5_000_000n,
    },
  ) {
    this.status = { ...status };
  }
}

export class FakeLipilaMobileMoneyTreasury implements MobileMoneyLiquidityRail {
  readonly attemptedDisbursementIdempotencyKeys: string[];
  readonly #remote: FakeLipilaRemoteState;

  constructor(
    stateOrStatus: FakeLipilaRemoteState | MobileMoneyTreasuryStatus = new FakeLipilaRemoteState(),
  ) {
    this.#remote =
      stateOrStatus instanceof FakeLipilaRemoteState
        ? stateOrStatus
        : new FakeLipilaRemoteState(stateOrStatus);
    this.attemptedDisbursementIdempotencyKeys = this.#remote.attemptedDisbursementIdempotencyKeys;
  }

  queueOutcome(operation: MobileMoneyOperation, outcome: ExternalOutcome): void {
    const queued = this.#remote.nextOutcomes.get(operation) ?? [];
    queued.push(outcome);
    this.#remote.nextOutcomes.set(operation, queued);
  }

  private outcome(operation: MobileMoneyOperation): ExternalOutcome {
    return this.#remote.nextOutcomes.get(operation)?.shift() ?? "success";
  }

  async collect(input: {
    amountZmwMinor: bigint;
    idempotencyKey: string;
  }): Promise<RailResult<{ checkoutUrl: string; lookupReference: string }>> {
    validateAmount(input.amountZmwMinor);
    const existing = this.#remote.collections.get(input.idempotencyKey);
    if (existing) {
      if (existing.amountZmwMinor !== input.amountZmwMinor) {
        throw new Error("Fake mobile-money collection idempotency conflict.");
      }
      return { outcome: "success", value: existing };
    }
    const outcome = this.outcome("collect");
    if (outcome !== "success" || !this.#remote.status.available) {
      return { outcome: outcome === "success" ? "failure" : outcome, value: null };
    }
    const suffix = digest(input.idempotencyKey);
    const collection = {
      amountZmwMinor: input.amountZmwMinor,
      checkoutUrl: `https://lipila.invalid/collect/${suffix}`,
      credited: false,
      lookupReference: `fake-lipila-collection-${suffix}`,
    };
    this.#remote.collections.set(input.idempotencyKey, collection);
    this.#remote.collectionStates.set(collection.lookupReference, "pending");
    return { outcome: "success", value: collection };
  }

  async getCollectionState(lookupReference: string): Promise<CollectionState> {
    return this.#remote.collectionStates.get(lookupReference) ?? "unknown";
  }

  setCollectionState(lookupReference: string, state: CollectionState): void {
    if (state === "settled") {
      for (const [key, collection] of this.#remote.collections) {
        if (collection.lookupReference === lookupReference && !collection.credited) {
          this.#remote.status.availableBalanceZmwMinor += collection.amountZmwMinor;
          this.#remote.collections.set(key, { ...collection, credited: true });
        }
      }
    }
    this.#remote.collectionStates.set(lookupReference, state);
  }

  async disburse(input: {
    amountZmwMinor: bigint;
    destination: {
      network: "airtel" | "mtn" | "zamtel";
      phone: string;
      type: "mobile_money";
    };
    idempotencyKey: string;
  }): Promise<RailResult<{ lookupReference: string }>> {
    validateAmount(input.amountZmwMinor);
    this.#remote.attemptedDisbursementIdempotencyKeys.push(input.idempotencyKey);
    const existing = this.#remote.disbursements.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountZmwMinor !== input.amountZmwMinor ||
        existing.destinationHash !== digest(JSON.stringify(input.destination))
      ) {
        throw new Error("Fake mobile-money disbursement idempotency conflict.");
      }
      return { outcome: "success", value: { lookupReference: existing.lookupReference } };
    }
    const uncertain = this.#remote.uncertainDisbursements.get(input.idempotencyKey);
    if (uncertain) {
      if (
        uncertain.amountZmwMinor !== input.amountZmwMinor ||
        uncertain.destinationHash !== digest(JSON.stringify(input.destination))
      ) {
        throw new Error("Fake mobile-money disbursement idempotency conflict.");
      }
      return { outcome: uncertain.outcome, value: null };
    }
    const outcome = this.outcome("disburse");
    if (outcome === "timeout" || outcome === "unknown") {
      this.#remote.uncertainDisbursements.set(input.idempotencyKey, {
        amountZmwMinor: input.amountZmwMinor,
        destinationHash: digest(JSON.stringify(input.destination)),
        outcome,
      });
      return { outcome, value: null };
    }
    if (
      outcome !== "success" ||
      !this.#remote.status.available ||
      this.#remote.status.availableBalanceZmwMinor < input.amountZmwMinor
    ) {
      return { outcome: outcome === "success" ? "failure" : outcome, value: null };
    }
    void input.destination;
    const disbursement = {
      amountZmwMinor: input.amountZmwMinor,
      destinationHash: digest(JSON.stringify(input.destination)),
      lookupReference: `fake-lipila-disbursement-${digest(input.idempotencyKey)}`,
    };
    this.#remote.disbursements.set(input.idempotencyKey, disbursement);
    this.#remote.status.availableBalanceZmwMinor -= input.amountZmwMinor;
    return { outcome: "success", value: { lookupReference: disbursement.lookupReference } };
  }

  async readStatus(): Promise<MobileMoneyTreasuryStatus> {
    return { ...this.#remote.status };
  }
}
