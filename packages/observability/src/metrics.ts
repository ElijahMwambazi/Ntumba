import { METRIC_NAMES } from "./metric-names.js";
import {
  type CallbackRejectionReason,
  methodLabel,
  type OutboxFailureCategory,
  registeredRouteLabel,
  responseClass,
} from "./privacy.js";

export type PaymentDirection = "btc_to_btc" | "btc_to_zmw" | "zmw_to_btc";
export type PaymentStatus =
  | "created"
  | "direct_payment_pending"
  | "direct_payment_settled"
  | "expired"
  | "failed"
  | "manual_review"
  | "provider_collecting"
  | "provider_settling"
  | "refund_pending"
  | "refunded"
  | "settled";
export type OperationalRecordType = "events" | "intents" | "outbox" | "quotes";
export type PurgeSource = "job" | "opportunistic";

export interface OperationalSnapshot {
  intents: Array<{ count: number; direction: PaymentDirection; status: PaymentStatus }>;
  lastAcceptedCallbackAt: Date | null;
  oldestPendingOutboxAt: Date | null;
  oldestUnprocessedEventAt: Date | null;
  outboxAttemptBuckets: Record<"1" | "2_3" | "4_plus", number>;
  outboxLastFailureCategory: OutboxFailureCategory;
  pendingOutbox: number;
  purgeEligible: Record<OperationalRecordType, number>;
  retained: Record<OperationalRecordType, number>;
  unprocessedProviderEvents: number;
}

export interface OperationalSnapshotReader {
  readOperationalSnapshot(now: Date): Promise<OperationalSnapshot>;
}

export interface MetricsContext {
  buildCommit: string;
  jobsEnabled: boolean;
  providerMode: "fake";
  publicRequestStore: "development_non_durable";
  rateMode: "fake" | "live";
  startedAt: Date;
}

export interface PurgeCounts {
  events: number;
  intents: number;
  outbox: number;
  quotes: number;
}

const histogramBuckets = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];
const recordTypes: OperationalRecordType[] = ["events", "intents", "outbox", "quotes"];
const directions: PaymentDirection[] = ["btc_to_btc", "btc_to_zmw", "zmw_to_btc"];
const paymentStatuses: PaymentStatus[] = [
  "created",
  "provider_collecting",
  "provider_settling",
  "direct_payment_pending",
  "direct_payment_settled",
  "settled",
  "expired",
  "failed",
  "refund_pending",
  "refunded",
  "manual_review",
];

interface HistogramValue {
  buckets: number[];
  count: number;
  sum: number;
}

function labels(values: Record<string, string>): string {
  const entries = Object.entries(values);
  if (entries.length === 0) {
    return "";
  }
  return `{${entries
    .map(
      ([name, value]) =>
        `${name}="${value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll('"', '\\"')}"`,
    )
    .join(",")}}`;
}

function ageSeconds(now: Date, timestamp: Date | null): number {
  return timestamp ? Math.max(0, (now.getTime() - timestamp.getTime()) / 1_000) : 0;
}

function metric(lines: string[], name: string, help: string, type: "counter" | "gauge") {
  lines.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
}

export function emptyOperationalSnapshot(): OperationalSnapshot {
  return {
    intents: [],
    lastAcceptedCallbackAt: null,
    oldestPendingOutboxAt: null,
    oldestUnprocessedEventAt: null,
    outboxAttemptBuckets: { "1": 0, "2_3": 0, "4_plus": 0 },
    outboxLastFailureCategory: "none",
    pendingOutbox: 0,
    purgeEligible: { events: 0, intents: 0, outbox: 0, quotes: 0 },
    retained: { events: 0, intents: 0, outbox: 0, quotes: 0 },
    unprocessedProviderEvents: 0,
  };
}

export class NtumbaMetrics {
  readonly #callbacks = new Map<string, number>();
  readonly #context: MetricsContext;
  readonly #httpDurations = new Map<string, HistogramValue>();
  readonly #httpRequests = new Map<string, number>();
  readonly #purgeFailures = new Map<PurgeSource, number>();
  readonly #purgeLastSuccess = new Map<PurgeSource, number>();
  readonly #purgedRecords = new Map<string, number>();

  constructor(context: MetricsContext) {
    this.#context = context;
  }

  observeHttp(input: {
    durationSeconds: number;
    method: string;
    routeTemplate: string | undefined;
    statusCode: number;
  }): void {
    const method = methodLabel(input.method);
    const route = registeredRouteLabel(input.routeTemplate);
    const status = responseClass(input.statusCode);
    const requestKey = JSON.stringify([method, route, status]);
    this.#httpRequests.set(requestKey, (this.#httpRequests.get(requestKey) ?? 0) + 1);

    const durationKey = JSON.stringify([method, route]);
    const value = this.#httpDurations.get(durationKey) ?? {
      buckets: histogramBuckets.map(() => 0),
      count: 0,
      sum: 0,
    };
    value.count += 1;
    value.sum += Math.max(0, input.durationSeconds);
    histogramBuckets.forEach((bucket, index) => {
      if (input.durationSeconds <= bucket) {
        value.buckets[index] = (value.buckets[index] ?? 0) + 1;
      }
    });
    this.#httpDurations.set(durationKey, value);
  }

  recordCallback(outcome: "accepted" | "duplicate"): void {
    this.#callbacks.set(outcome, (this.#callbacks.get(outcome) ?? 0) + 1);
  }

  recordCallbackRejected(reason: CallbackRejectionReason): void {
    const key = `rejected:${reason}`;
    this.#callbacks.set(key, (this.#callbacks.get(key) ?? 0) + 1);
  }

  recordPurgeFailure(source: PurgeSource): void {
    this.#purgeFailures.set(source, (this.#purgeFailures.get(source) ?? 0) + 1);
  }

  recordPurgeSuccess(source: PurgeSource, counts: PurgeCounts, completedAt = new Date()): void {
    this.#purgeLastSuccess.set(source, completedAt.getTime() / 1_000);
    for (const recordType of recordTypes) {
      const key = `${source}:${recordType}`;
      this.#purgedRecords.set(key, (this.#purgedRecords.get(key) ?? 0) + counts[recordType]);
    }
  }

  render(snapshot: OperationalSnapshot, databaseAvailable: boolean, now = new Date()): string {
    const lines: string[] = [];
    metric(
      lines,
      METRIC_NAMES.serverProcessUp,
      "Whether the Ntumba server process is running.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.serverProcessUp} 1`);
    metric(
      lines,
      METRIC_NAMES.serverStartTime,
      "Unix timestamp when the server process started.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.serverStartTime} ${this.#context.startedAt.getTime() / 1_000}`);
    metric(lines, METRIC_NAMES.buildInfo, "Build commit information.", "gauge");
    lines.push(`${METRIC_NAMES.buildInfo}${labels({ commit: this.#context.buildCommit })} 1`);
    metric(
      lines,
      METRIC_NAMES.databaseAvailable,
      "Whether aggregate database reads succeed.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.databaseAvailable} ${databaseAvailable ? 1 : 0}`);
    metric(lines, METRIC_NAMES.jobsEnabled, "Whether background jobs are enabled.", "gauge");
    lines.push(`${METRIC_NAMES.jobsEnabled} ${this.#context.jobsEnabled ? 1 : 0}`);
    metric(lines, METRIC_NAMES.modeInfo, "Safe runtime mode information.", "gauge");
    lines.push(
      `${METRIC_NAMES.modeInfo}${labels({ provider_mode: this.#context.providerMode, public_request_store: this.#context.publicRequestStore, rate_mode: this.#context.rateMode })} 1`,
    );

    metric(
      lines,
      METRIC_NAMES.httpRequests,
      "Public API requests by registered route template.",
      "counter",
    );
    metric(
      lines,
      METRIC_NAMES.httpServerErrors,
      "Public API server errors by bounded labels.",
      "counter",
    );
    for (const [key, value] of [...this.#httpRequests].sort()) {
      const [method, route, status] = JSON.parse(key) as [string, string, string];
      lines.push(
        `${METRIC_NAMES.httpRequests}${labels({ method, response_class: status, route })} ${value}`,
      );
      if (status === "5xx") {
        lines.push(
          `${METRIC_NAMES.httpServerErrors}${labels({ method, response_class: status, route })} ${value}`,
        );
      }
    }

    lines.push(
      `# HELP ${METRIC_NAMES.httpDuration} Public API request duration by registered route template.`,
      `# TYPE ${METRIC_NAMES.httpDuration} histogram`,
    );
    for (const [key, value] of [...this.#httpDurations].sort()) {
      const [method, route] = JSON.parse(key) as [string, string];
      histogramBuckets.forEach((bucket, index) => {
        lines.push(
          `${METRIC_NAMES.httpDuration}_bucket${labels({ le: String(bucket), method, route })} ${value.buckets[index] ?? 0}`,
        );
      });
      lines.push(
        `${METRIC_NAMES.httpDuration}_bucket${labels({ le: "+Inf", method, route })} ${value.count}`,
        `${METRIC_NAMES.httpDuration}_sum${labels({ method, route })} ${value.sum}`,
        `${METRIC_NAMES.httpDuration}_count${labels({ method, route })} ${value.count}`,
      );
    }

    metric(
      lines,
      METRIC_NAMES.intentCount,
      "Retained payment intents by direction and normalized status.",
      "gauge",
    );
    for (const direction of directions) {
      for (const status of paymentStatuses) {
        const count =
          snapshot.intents.find((item) => item.direction === direction && item.status === status)
            ?.count ?? 0;
        lines.push(`${METRIC_NAMES.intentCount}${labels({ direction, status })} ${count}`);
      }
    }

    metric(lines, METRIC_NAMES.recordsRetained, "Retained aggregate operational records.", "gauge");
    metric(
      lines,
      METRIC_NAMES.recordsEligibleForPurge,
      "Operational records currently eligible for purge.",
      "gauge",
    );
    for (const recordType of recordTypes) {
      lines.push(
        `${METRIC_NAMES.recordsRetained}${labels({ record_type: recordType })} ${snapshot.retained[recordType]}`,
        `${METRIC_NAMES.recordsEligibleForPurge}${labels({ record_type: recordType })} ${snapshot.purgeEligible[recordType]}`,
      );
    }

    metric(
      lines,
      METRIC_NAMES.providerEventsUnprocessed,
      "Unprocessed normalized provider events.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.providerEventsUnprocessed} ${snapshot.unprocessedProviderEvents}`);
    metric(
      lines,
      METRIC_NAMES.providerEventsOldestAge,
      "Age of the oldest unprocessed provider event.",
      "gauge",
    );
    lines.push(
      `${METRIC_NAMES.providerEventsOldestAge} ${ageSeconds(now, snapshot.oldestUnprocessedEventAt)}`,
    );
    metric(
      lines,
      METRIC_NAMES.outboxPending,
      "Pending payload-free provider-intent outbox rows.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.outboxPending} ${snapshot.pendingOutbox}`);
    metric(lines, METRIC_NAMES.outboxOldestAge, "Age of the oldest pending outbox row.", "gauge");
    lines.push(
      `${METRIC_NAMES.outboxOldestAge} ${ageSeconds(now, snapshot.oldestPendingOutboxAt)}`,
    );
    metric(
      lines,
      METRIC_NAMES.outboxAttempts,
      "Pending outbox rows by bounded attempt bucket.",
      "gauge",
    );
    for (const bucket of ["1", "2_3", "4_plus"] as const) {
      lines.push(
        `${METRIC_NAMES.outboxAttempts}${labels({ bucket })} ${snapshot.outboxAttemptBuckets[bucket]}`,
      );
    }
    metric(
      lines,
      METRIC_NAMES.outboxLastFailure,
      "Most recent safe pending-outbox failure category.",
      "gauge",
    );
    lines.push(
      `${METRIC_NAMES.outboxLastFailure}${labels({ category: snapshot.outboxLastFailureCategory })} 1`,
    );

    metric(
      lines,
      METRIC_NAMES.callbacks,
      "Provider callback outcomes with bounded safe reasons.",
      "counter",
    );
    for (const [key, value] of [...this.#callbacks].sort()) {
      if (key.startsWith("rejected:")) {
        lines.push(
          `${METRIC_NAMES.callbacks}${labels({ outcome: "rejected", reason: key.slice(9) })} ${value}`,
        );
      } else {
        lines.push(`${METRIC_NAMES.callbacks}${labels({ outcome: key, reason: "none" })} ${value}`);
      }
    }
    metric(
      lines,
      METRIC_NAMES.callbackLastAccepted,
      "Unix timestamp of the last retained accepted callback.",
      "gauge",
    );
    lines.push(
      `${METRIC_NAMES.callbackLastAccepted} ${snapshot.lastAcceptedCallbackAt?.getTime() ? snapshot.lastAcceptedCallbackAt.getTime() / 1_000 : 0}`,
    );

    metric(
      lines,
      METRIC_NAMES.purgeLastSuccess,
      "Unix timestamp of the last successful purge by source.",
      "gauge",
    );
    metric(lines, METRIC_NAMES.purgeFailures, "Purge failures by bounded source.", "counter");
    metric(
      lines,
      METRIC_NAMES.purgedRecords,
      "Purged operational records by source and type.",
      "counter",
    );
    for (const source of ["job", "opportunistic"] as const) {
      lines.push(
        `${METRIC_NAMES.purgeLastSuccess}${labels({ source })} ${this.#purgeLastSuccess.get(source) ?? 0}`,
        `${METRIC_NAMES.purgeFailures}${labels({ source })} ${this.#purgeFailures.get(source) ?? 0}`,
      );
      for (const recordType of recordTypes) {
        lines.push(
          `${METRIC_NAMES.purgedRecords}${labels({ record_type: recordType, source })} ${this.#purgedRecords.get(`${source}:${recordType}`) ?? 0}`,
        );
      }
    }

    metric(
      lines,
      METRIC_NAMES.railState,
      "Truthful payment rail state; fake-only is never real-payment health.",
      "gauge",
    );
    for (const direction of directions) {
      for (const state of ["available", "fake_only", "not_configured", "unhealthy"]) {
        lines.push(
          `${METRIC_NAMES.railState}${labels({ direction, state })} ${state === "fake_only" ? 1 : 0}`,
        );
      }
    }
    metric(
      lines,
      METRIC_NAMES.lightningCapability,
      "Read-only external Lightning capability state.",
      "gauge",
    );
    for (const capability of [
      "node",
      "external_channel_capacity",
      "inbound_capacity",
      "outbound_capacity",
      "payment_verification",
    ]) {
      lines.push(
        `${METRIC_NAMES.lightningCapability}${labels({ capability, state: capability.includes("capacity") ? "unavailable" : "not_configured" })} 1`,
      );
    }
    metric(
      lines,
      METRIC_NAMES.mobileMoneyCapability,
      "Read-only mobile-money provider capability state.",
      "gauge",
    );
    for (const [capability, state] of [
      ["provider_mode", "fake"],
      ["live_rail", "not_configured"],
      ["collection", "development_only"],
      ["settlement", "development_only"],
      ["provider_reported_limits", "unavailable"],
      ["last_real_settlement", "never"],
    ]) {
      lines.push(
        `${METRIC_NAMES.mobileMoneyCapability}${labels({ capability: capability ?? "unknown", state: state ?? "unknown" })} 1`,
      );
    }
    metric(
      lines,
      METRIC_NAMES.rateLastSuccess,
      "Unix timestamp of the last successful live rate refresh; zero in fake mode.",
      "gauge",
    );
    lines.push(`${METRIC_NAMES.rateLastSuccess} 0`);

    return `${lines.join("\n")}\n`;
  }
}
