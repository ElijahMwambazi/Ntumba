import { describe, expect, it } from "vitest";
import { emptyOperationalSnapshot, NtumbaMetrics } from "./metrics.js";
import { registeredRouteLabel, safeOutboxFailureCategory } from "./privacy.js";
import { fakeProviderCapacityStatus, unavailableLightningStatus } from "./status.js";

function metrics() {
  return new NtumbaMetrics({
    buildCommit: "2990f1b",
    jobsEnabled: true,
    providerMode: "fake",
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

  it("reports fake rails and missing read-only adapters explicitly", () => {
    const output = metrics().render(emptyOperationalSnapshot(), true);
    expect(output).toContain('direction="btc_to_btc",state="fake_only"} 1');
    expect(output).toContain('direction="btc_to_btc",state="available"} 0');
    expect(output).toContain('direction="btc_to_btc",state="not_configured"} 0');
    expect(output).toContain('direction="btc_to_btc",state="unhealthy"} 0');
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
