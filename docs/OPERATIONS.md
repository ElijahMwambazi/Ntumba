# Operations

Ntumba must remain operable by one person while making the conversion bridge's operator-liquidity
obligations explicit.

## Development operation

- Bridge disabled by default; deterministic fake Voltage/LND and Lipila treasuries only.
- PostgreSQL holds short-lived opaque operational records and the authoritative fake settlement
  saga; coordinator restarts do not lose reservations, obligations, attempts or journal state.
- PostgreSQL 18 volumes mount at `/var/lib/postgresql`; volumes from an older major release require
  a reviewed `pg_upgrade` and must never be silently reinitialized.
- pg-boss runs hourly purge plus PostgreSQL-backed provider-event and destination-settlement
  workers when jobs are enabled.
- No provider credential, wallet credential or real payment action exists.
- The destination vault is process memory only. Restart/expiry after conclusive source settlement
  creates one `refund_required` obligation.
- Private operator metrics are disabled by default. After the documented forward-only migration
  step, `docker compose --profile ops up --build` starts the bearer-protected internal listener,
  private Prometheus and loopback-only Grafana after the required shell secrets are supplied; see
  [Private operator dashboard](OPERATOR_DASHBOARD.md).

## Daily pilot checks

- Compare opaque intents, two legs, asset-specific journal entries and normalized events.
- Review source/destination failures, refund-required/refund-pending and manual-review intents.
- Review reconciliation-review-required separately from payment settlement; a mismatch must never
  trigger an automatic second destination payment.
- Check fake BTC/ZMW available and reserved inventory, unsettled liabilities and pipeline counts.
- Confirm expiry/purge job success and database backups.
- Check reconciliation freshness, stale rates, rail availability and error/latency alerts.

Fake treasury values are simulations. Production operation will require independently reconciled
operator LND and Lipila balances, channel capacity, destination reservations, liabilities, refund
capital and rate exposure.

## Circuit breakers

Disable a direction when destination liquidity cannot be reserved, rates are stale, a rail is
unhealthy, callbacks cannot be verified, reconciliation differs, destination recovery fails,
purge is failing or failure/manual-review rates exceed thresholds.

## Incident priorities

1. Disable new conversion intents on the affected direction.
2. Preserve safe opaque references, hashes and normalized timestamps.
3. Reconcile source collection, destination obligation, rail reports and asset-specific journal.
4. Communicate confirmed status without exposing personal data.
5. Confirm destination settlement or establish and track the operator's refund obligation.
6. Document cause and prevention.

First-response procedures are in [Operator runbooks](RUNBOOKS.md). The dashboard is read-only and
cannot perform any incident action itself.

## Production gates

Provider contracts must define Lipila and Voltage responsibilities, but Ntumba remains responsible
for its conversion liquidity, second-leg failures and refunds. Qualified counsel must review
custody/safeguarding, payment-services, AML/KYC, consumer, privacy, tax and record-retention
obligations in Zambia. These documents are engineering boundaries, not legal conclusions.
