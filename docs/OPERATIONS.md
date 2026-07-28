# Operations

Ntumba must remain operable by one person without controlling funds.

## Development operation

- Safe fake provider only.
- PostgreSQL holds short-lived opaque operational records.
- PostgreSQL 18 volumes mount at `/var/lib/postgresql`; volumes from an older major release require
  a reviewed `pg_upgrade` and must never be silently reinitialized.
- pg-boss runs the hourly `purge-operational-data` job when jobs are enabled.
- Pending provider-intent outbox rows identify client requests that must be safely retried with the
  original idempotency key and transient destination; operators cannot dispatch them without that
  destination.
- No provider credential, wallet credential or real payment action exists.
- Private operator metrics are disabled by default. After the documented forward-only migration
  step, `docker compose --profile ops up --build` starts the bearer-protected internal listener,
  private Prometheus and loopback-only Grafana after the required shell secrets are supplied; see
  [Private operator dashboard](OPERATOR_DASHBOARD.md).

## Daily pilot checks

- Compare opaque intents and normalized events with provider reports.
- Review failed, refund-pending and manual-review intents.
- Confirm expiry/purge job success and database backups.
- Check stale rates, provider health and error/latency alerts.

No liquidity or treasury check belongs to Ntumba; the settlement provider owns those concerns.
The dashboard therefore reports rail availability, external Lightning channel-capacity
placeholders, provider-reported settlement capacity and provider transaction limits—never
“Ntumba liquidity.”

## Circuit breakers

Disable a direction when rates are stale, a provider is unhealthy, callbacks cannot be verified,
reconciliation differs, purge is failing or failure/manual-review rates exceed thresholds.

## Incident priorities

1. Stop creating affected provider intents.
2. Preserve safe opaque references, hashes and normalized timestamps.
3. Ask the provider to reconcile collection and settlement.
4. Communicate confirmed status without exposing personal data.
5. Confirm provider-led settlement or refund.
6. Document cause and prevention.

First-response procedures are in [Operator runbooks](RUNBOOKS.md). The dashboard is read-only and
cannot perform any incident action itself.

## Production gates

Provider contracts must explicitly establish provider ownership of collection, settlement,
refunds, safeguarding and support. Qualified counsel must review payment-services, AML/KYC,
consumer, privacy, tax and record-retention obligations in Zambia. These documents are engineering
boundaries, not legal conclusions.
