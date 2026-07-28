import { describe, expect, it } from "vitest";
import { emptyOperationalSnapshot, NtumbaMetrics } from "./metrics.js";
import { registeredRouteLabel, safeOutboxFailureCategory } from "./privacy.js";
import { fakeProviderCapacityStatus, unavailableLightningStatus } from "./status.js";

function metrics() {
  return new NtumbaMetrics({
    bitcoinRailMode: "fake",
    bridgeMode: "fake",
    buildCommit: "2990f1b",
    jobsEnabled: true,
    mobileMoneyRailMode: "fake",
    publicRequestStore: "development_non_durable",
    rateMode: "fake",
    startedAt: new Date("2026-07-28T10:00:00.000Z"),
  });
}

describe("private operational metrics", () => {
  it("uses registered route templates and rejects raw identifiers", () => {
    const collector = metrics();
    collector.observeHttp({
      durationSeconds: 0.02,
      method: "GET",
      routeTemplate: "/api/v1/payment-intents/:id",
      statusCode: 200,
    });
    collector.observeHttp({
      durationSeconds: 0.03,
      method: "GET",
      routeTemplate: "/api/v1/payment-intents/14c9fd48-b2b4-436a-989c-f540122c8dad?token=secret",
      statusCode: 500,
    });

    const output = collector.render(emptyOperationalSnapshot(), true);
    expect(output).toContain('route="/api/v1/payment-intents/:id"');
    expect(output).toContain('route="unmatched"');
    expect(output).not.toContain("14c9fd48-b2b4-436a-989c-f540122c8dad");
    expect(output).not.toContain("token=secret");
    expect(registeredRouteLabel("/pay/a88a4f52-fdc8-4df0-aeb7-45b9bd59f9ae")).toBe("unmatched");
  });

  it("never renders payment or callback fixture data", () => {
    const collector = metrics();
    collector.recordCallback("accepted");
    collector.recordCallbackRejected("signature");
    collector.recordPurgeSuccess("job", { events: 1, intents: 2, outbox: 3, quotes: 4 });
    const output = collector.render(
      {
        ...emptyOperationalSnapshot(),
        outboxLastFailureCategory: safeOutboxFailureCategory("provider returned 0971234567"),
      },
      true,
    );

    for (const forbidden of [
      "0971234567",
      "alice@example.com",
      "lntb10n1merchantinvoice",
      "Market stall",
      "a88a4f52-fdc8-4df0-aeb7-45b9bd59f9ae",
      "fake-intent-secret-reference",
      "opaque-destination-token",
      "callback raw body",
    ]) {
      expect(output).not.toContain(forbidden);
    }
    expect(output).toContain('category="other_safe_failure"');
  });

  it("reports fake treasury liquidity and bounded pipeline stages without identifiers", () => {
    const snapshot = emptyOperationalSnapshot();
    snapshot.treasury = {
      bitcoinBalanceSats: 4_000_000n,
      inboundCapacitySats: 8_000_000n,
      lastSuccessfulReconciliationAt: new Date("2026-07-28T11:00:00.000Z"),
      lightningAvailable: true,
      manualReview: 1,
      mobileMoneyAvailable: true,
      mobileMoneyBalanceZmwMinor: 3_000_000n,
      outboundCapacitySats: 3_500_000n,
      refundRequired: 2,
      reservedBtcSats: 50_000n,
      reservedZmwMinor: 75_000n,
      unsettledBtcLiabilitySats: 25_000n,
      unsettledZmwLiabilityMinor: 40_000n,
      waitingDestinationSettlement: 3,
      waitingSourcePayment: 4,
    };
    const output = metrics().render(snapshot, true);

    expect(output).toContain("ntumba_fake_lightning_node_available 1");
    expect(output).toContain("ntumba_fake_bitcoin_treasury_balance_sats 4000000");
    expect(output).toContain("ntumba_fake_lightning_inbound_capacity_sats 8000000");
    expect(output).toContain("ntumba_fake_lightning_outbound_capacity_sats 3500000");
    expect(output).toContain("ntumba_fake_lipila_available 1");
    expect(output).toContain("ntumba_fake_lipila_treasury_balance_zmw_minor 3000000");
    expect(output).toContain('ntumba_treasury_reserved{asset="BTC"} 50000');
    expect(output).toContain('ntumba_treasury_reserved{asset="ZMW"} 75000');
    expect(output).toContain('ntumba_treasury_unsettled_liability{asset="BTC"} 25000');
    expect(output).toContain('ntumba_treasury_unsettled_liability{asset="ZMW"} 40000');
    expect(output).toContain(
      'ntumba_treasury_pipeline_transactions{stage="awaiting_source_payment"} 4',
    );
    expect(output).toContain(
      'ntumba_treasury_pipeline_transactions{stage="awaiting_destination_settlement"} 3',
    );
    expect(output).toContain('ntumba_treasury_pipeline_transactions{stage="refund_required"} 2');
    expect(output).toContain('ntumba_treasury_pipeline_transactions{stage="manual_review"} 1');
    expect(output).toContain("ntumba_reconciliation_last_success_timestamp_seconds 1785236400");
    expect(output).not.toMatch(
      /payment_id=|provider_reference=|phone=|invoice=|destination=|merchant=/,
    );
  });

  it("reports fake rails and missing direct-payment verification explicitly", () => {
    const output = metrics().render(emptyOperationalSnapshot(), true);
    expect(output).toContain('direction="btc_to_btc",state="fake_only"} 1');
    expect(output).toContain('direction="btc_to_btc",state="available"} 0');
    expect(output).toContain('direction="btc_to_btc",state="not_configured"} 0');
    expect(output).toContain('direction="btc_to_btc",state="unhealthy"} 0');
    expect(output).toContain('capability="node",state="fake_only"} 1');
    expect(output).toContain('capability="payment_verification",state="not_configured"} 1');
    expect(unavailableLightningStatus()).toEqual({
      externalChannelCapacitySats: null,
      inboundCapacitySats: null,
      node: "not_configured",
      outboundCapacitySats: null,
      paymentVerification: "not_configured",
    });
    expect(fakeProviderCapacityStatus()).toMatchObject({
      collection: "development_only",
      lastRealSettlementAt: null,
      providerReportedSettlementCapacitySats: null,
      settlement: "development_only",
    });
  });

  it("updates callback and purge metrics with bounded labels", () => {
    const collector = metrics();
    collector.recordCallback("accepted");
    collector.recordCallback("duplicate");
    collector.recordCallbackRejected("timestamp");
    collector.recordPurgeFailure("job");
    collector.recordPurgeSuccess(
      "opportunistic",
      { events: 2, intents: 1, outbox: 1, quotes: 3 },
      new Date("2026-07-28T11:00:00.000Z"),
    );
    const output = collector.render(emptyOperationalSnapshot(), true);
    expect(output).toContain('outcome="accepted",reason="none"} 1');
    expect(output).toContain('outcome="duplicate",reason="none"} 1');
    expect(output).toContain('outcome="rejected",reason="timestamp"} 1');
    expect(output).toContain('source="job"} 1');
    expect(output).toContain('record_type="events",source="opportunistic"} 2');
  });
});
