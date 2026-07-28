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

export class FakeVoltageLndTreasury implements BitcoinLiquidityRail {
  readonly attemptedPaymentIdempotencyKeys: string[] = [];
  readonly #createdInvoices = new Map<
    string,
    {
      amountSats: bigint;
      credited: boolean;
      expiresAt: Date;
      lookupReference: string;
      paymentRequest: string;
    }
  >();
  readonly #invoiceStates = new Map<string, InvoiceState>();
  readonly #nextOutcomes = new Map<BitcoinOperation, ExternalOutcome[]>();
  readonly #paidInvoices = new Map<
    string,
    { amountSats: bigint; lookupReference: string; paymentRequestHash: string }
  >();
  #status: BitcoinTreasuryStatus;

  constructor(
    status: BitcoinTreasuryStatus = {
      available: true,
      availableBalanceSats: 5_000_000n,
      inboundCapacitySats: 10_000_000n,
      outboundCapacitySats: 5_000_000n,
    },
  ) {
    this.#status = { ...status };
  }

  queueOutcome(operation: BitcoinOperation, outcome: ExternalOutcome): void {
    const queued = this.#nextOutcomes.get(operation) ?? [];
    queued.push(outcome);
    this.#nextOutcomes.set(operation, queued);
  }

  private outcome(operation: BitcoinOperation): ExternalOutcome {
    const queued = this.#nextOutcomes.get(operation);
    return queued?.shift() ?? "success";
  }

  async createInvoice(input: {
    amountSats: bigint;
    expiresAt: Date;
    idempotencyKey: string;
  }): Promise<RailResult<{ expiresAt: Date; lookupReference: string; paymentRequest: string }>> {
    validateAmount(input.amountSats);
    const existing = this.#createdInvoices.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountSats !== input.amountSats ||
        existing.expiresAt.getTime() !== input.expiresAt.getTime()
      ) {
        throw new Error("Fake Lightning invoice idempotency conflict.");
      }
      return { outcome: "success", value: { ...existing } };
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
    this.#createdInvoices.set(input.idempotencyKey, invoice);
    this.#invoiceStates.set(invoice.lookupReference, "pending");
    return { outcome: "success", value: { ...invoice } };
  }

  async getInvoiceState(lookupReference: string): Promise<InvoiceState> {
    return this.#invoiceStates.get(lookupReference) ?? "unknown";
  }

  setInvoiceState(lookupReference: string, state: InvoiceState): void {
    this.#invoiceStates.set(lookupReference, state);
    if (state !== "settled") {
      return;
    }
    for (const [key, invoice] of this.#createdInvoices) {
      if (invoice.lookupReference === lookupReference && !invoice.credited) {
        this.#status.availableBalanceSats += invoice.amountSats;
        this.#createdInvoices.set(key, { ...invoice, credited: true });
      }
    }
  }

  async payInvoice(input: {
    amountSats: bigint;
    idempotencyKey: string;
    paymentRequest: string;
  }): Promise<RailResult<{ lookupReference: string }>> {
    validateAmount(input.amountSats);
    this.attemptedPaymentIdempotencyKeys.push(input.idempotencyKey);
    const existing = this.#paidInvoices.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountSats !== input.amountSats ||
        existing.paymentRequestHash !== digest(input.paymentRequest)
      ) {
        throw new Error("Fake Lightning payment idempotency conflict.");
      }
      return { outcome: "success", value: { lookupReference: existing.lookupReference } };
    }
    const outcome = this.outcome("pay_invoice");
    if (
      outcome !== "success" ||
      !this.#status.available ||
      this.#status.availableBalanceSats < input.amountSats ||
      this.#status.outboundCapacitySats < input.amountSats
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
    this.#paidInvoices.set(input.idempotencyKey, payment);
    this.#status.availableBalanceSats -= input.amountSats;
    this.#status.outboundCapacitySats -= input.amountSats;
    return { outcome: "success", value: { lookupReference: payment.lookupReference } };
  }

  async readStatus(): Promise<BitcoinTreasuryStatus> {
    return { ...this.#status };
  }
}

export class FakeLipilaMobileMoneyTreasury implements MobileMoneyLiquidityRail {
  readonly attemptedDisbursementIdempotencyKeys: string[] = [];
  readonly #collections = new Map<
    string,
    { amountZmwMinor: bigint; checkoutUrl: string; lookupReference: string }
  >();
  readonly #collectionStates = new Map<string, CollectionState>();
  readonly #disbursements = new Map<
    string,
    { amountZmwMinor: bigint; destinationHash: string; lookupReference: string }
  >();
  readonly #nextOutcomes = new Map<MobileMoneyOperation, ExternalOutcome[]>();
  #status: MobileMoneyTreasuryStatus;

  constructor(
    status: MobileMoneyTreasuryStatus = {
      available: true,
      availableBalanceZmwMinor: 5_000_000n,
    },
  ) {
    this.#status = { ...status };
  }

  queueOutcome(operation: MobileMoneyOperation, outcome: ExternalOutcome): void {
    const queued = this.#nextOutcomes.get(operation) ?? [];
    queued.push(outcome);
    this.#nextOutcomes.set(operation, queued);
  }

  private outcome(operation: MobileMoneyOperation): ExternalOutcome {
    return this.#nextOutcomes.get(operation)?.shift() ?? "success";
  }

  async collect(input: {
    amountZmwMinor: bigint;
    idempotencyKey: string;
  }): Promise<RailResult<{ checkoutUrl: string; lookupReference: string }>> {
    validateAmount(input.amountZmwMinor);
    const existing = this.#collections.get(input.idempotencyKey);
    if (existing) {
      if (existing.amountZmwMinor !== input.amountZmwMinor) {
        throw new Error("Fake mobile-money collection idempotency conflict.");
      }
      return { outcome: "success", value: existing };
    }
    const outcome = this.outcome("collect");
    if (outcome !== "success" || !this.#status.available) {
      return { outcome: outcome === "success" ? "failure" : outcome, value: null };
    }
    const suffix = digest(input.idempotencyKey);
    const collection = {
      amountZmwMinor: input.amountZmwMinor,
      checkoutUrl: `https://lipila.invalid/collect/${suffix}`,
      lookupReference: `fake-lipila-collection-${suffix}`,
    };
    this.#collections.set(input.idempotencyKey, collection);
    this.#collectionStates.set(collection.lookupReference, "pending");
    return { outcome: "success", value: collection };
  }

  async getCollectionState(lookupReference: string): Promise<CollectionState> {
    return this.#collectionStates.get(lookupReference) ?? "unknown";
  }

  setCollectionState(lookupReference: string, state: CollectionState, amountZmwMinor = 0n): void {
    this.#collectionStates.set(lookupReference, state);
    if (state === "settled" && amountZmwMinor > 0n) {
      this.#status.availableBalanceZmwMinor += amountZmwMinor;
    }
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
    this.attemptedDisbursementIdempotencyKeys.push(input.idempotencyKey);
    const existing = this.#disbursements.get(input.idempotencyKey);
    if (existing) {
      if (
        existing.amountZmwMinor !== input.amountZmwMinor ||
        existing.destinationHash !== digest(JSON.stringify(input.destination))
      ) {
        throw new Error("Fake mobile-money disbursement idempotency conflict.");
      }
      return { outcome: "success", value: { lookupReference: existing.lookupReference } };
    }
    const outcome = this.outcome("disburse");
    if (
      outcome !== "success" ||
      !this.#status.available ||
      this.#status.availableBalanceZmwMinor < input.amountZmwMinor
    ) {
      return { outcome: outcome === "success" ? "failure" : outcome, value: null };
    }
    void input.destination;
    const disbursement = {
      amountZmwMinor: input.amountZmwMinor,
      destinationHash: digest(JSON.stringify(input.destination)),
      lookupReference: `fake-lipila-disbursement-${digest(input.idempotencyKey)}`,
    };
    this.#disbursements.set(input.idempotencyKey, disbursement);
    this.#status.availableBalanceZmwMinor -= input.amountZmwMinor;
    return { outcome: "success", value: { lookupReference: disbursement.lookupReference } };
  }

  async readStatus(): Promise<MobileMoneyTreasuryStatus> {
    return { ...this.#status };
  }
}
