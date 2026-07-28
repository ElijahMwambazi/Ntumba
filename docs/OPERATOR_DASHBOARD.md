# Private Operator Dashboard

## Purpose and architecture

The **Ntumba Operator** dashboard is for the sole Ntumba operator. It is not a merchant feature,
payer feature, public status page or administrative control plane.

```text
Public 3000 ──> Ntumba Fastify API + merchant PWA
                     │
                     ├── aggregate-only PaymentStore reads ──> PostgreSQL
                     │
Private 9091 ─> bearer-protected health + Prometheus metrics
                     ▲
                     │ private Compose network only
               Prometheus ──> provisioned alerts
                     │
               Grafana 3000 ──> host 127.0.0.1:3001 only
```

The public and internal listeners run in the same TypeScript modular-monolith process but use
separate Fastify instances and ports. `OPS_ENABLED=false` is the default. The public application
does not register `/metrics`, `/ops` or `/admin`, and the merchant PWA contains no operator link.

## Local startup

Create strong, temporary shell values. Do not commit them to `.env` or provisioning files.

```bash
export OPS_METRICS_TOKEN="$(openssl rand -hex 32)"
export GRAFANA_ADMIN_PASSWORD="$(openssl rand -base64 36)"
export NTUMBA_BUILD_COMMIT="$(git rev-parse HEAD)"
docker compose up -d database
docker compose --profile ops run --rm --build ops-app yarn db:migrate
docker compose --profile ops up --build
```

Open Grafana at <http://127.0.0.1:3001> and sign in as `ntumba-operator` (or the value of
`GRAFANA_ADMIN_USER`) with the password supplied above. The existing production profile remains
separate: `docker compose --profile production up` does not enable the internal listener.

Run the forward-only migration command before the stack starts on a fresh database and after
pulling a revision that adds migrations. It applies only repository migrations; this observability
milestone adds no schema migration.

PostgreSQL 18 stores versioned clusters under `/var/lib/postgresql`. If an existing
`ntumba-postgres` volume was created by an older major version, preserve it and complete a reviewed
`pg_upgrade` procedure before starting PostgreSQL 18. Do not delete or silently reinitialize an
operator volume to bypass the major-version boundary.

Compose passes the bearer token to the application and Prometheus as an in-memory Compose secret.
Prometheus and port 9091 remain private to the Compose network. Grafana is the only operator
service published to the host, and it binds only to loopback.

To stop the local stack:

```bash
docker compose --profile ops down
unset OPS_METRICS_TOKEN GRAFANA_ADMIN_PASSWORD NTUMBA_BUILD_COMMIT
```

## Access boundary

- Every internal request requires the exact bearer token, including `/health` and `/metrics`.
- Tokens are compared in constant time and authorization headers are redacted from internal logs.
- The public API port never serves the operational endpoints.
- Grafana anonymous access and sign-up are disabled. Provisioned dashboards are read-only.
- Grafana reporting, update checks, plugin update checks and suggested-plugin preinstallation are
  disabled so the private dashboard does not make routine outbound catalog requests.
- Prometheus has no published host port or write-capable lifecycle endpoint.
- No wallet seed, wallet-unlock credential, LND admin macaroon or fund-moving credential belongs in
  this stack.
- No action in the dashboard changes payment state, pauses rails or initiates a payment.

For future remote access, install and administer Tailscale separately, keep Grafana bound to
loopback, and use Tailscale Serve to publish it only inside the operator's tailnet, for example:

```bash
tailscale serve --bg http://127.0.0.1:3001
```

Do not use Tailscale Funnel or another public tunnel. Ntumba does not automate Tailscale
installation, identity policy or Serve configuration.

## Metric catalogue

All names use the `ntumba_` prefix. Labels are bounded enums or registered Fastify route templates.

| Area | Metrics |
| --- | --- |
| Process | `server_process_up`, `server_start_time_seconds`, `build_info` |
| Safe modes | `jobs_enabled`, `mode_info`, `rail_state`, `lightning_capability`, `mobile_money_capability` |
| HTTP | `http_requests_total`, `http_request_duration_seconds`, `http_server_errors_total` |
| Payments | `payment_intents` by direction/status; retained and purge-eligible record counts |
| Callbacks | `provider_callbacks_total`, `callback_last_accepted_timestamp_seconds`, unprocessed count/oldest age |
| Outbox | pending count, oldest age, bounded attempt buckets and safe last-failure category |
| Retention | last successful purge, failures, purged counts and records eligible for purge |
| Rate placeholder | `rate_last_success_timestamp_seconds`, which is zero while the rate mode is fake |

Metrics never contain merchant names, references, phone numbers, Lightning addresses, invoices,
public/local IDs, payment-intent IDs, provider references, destination tokens, idempotency keys,
callback bodies, database URLs or credentials. HTTP labels use registered route templates such as
`/api/v1/payment-intents/:id`, never the raw URL.

## Dashboard sections

1. **Overview** — development status, API/database/jobs, provider/rate modes, public-request
   durability warning and build commit.
2. **Attention required** — manual review, refund pending, failed intents, backlog ages and purge
   failures.
3. **Payment pipeline** — aggregate intent direction/state and provider/direct states.
4. **Provider and callbacks** — acceptance/rejection, duplicates/conflicts, last callback and
   event/outbox backlog.
5. **Bitcoin rail** — fake-only rail state plus explicit node, verification and external-channel
   capacity unavailability.
6. **Mobile-money rail** — fake provider, development-only collection/settlement, unavailable
   provider-reported limits and no real settlement.
7. **Privacy and lifecycle** — retained/overdue records, purge status and the storage boundary.

## Fake and not-configured semantics

- `fake_only`: executable only through deterministic development fakes; never healthy for real
  money.
- `not_configured`: no live integration or credential exists.
- `available`: reserved for a reviewed live read-only adapter that has passed freshness/health
  checks. No current rail reports this state.
- `unhealthy`: a configured live capability failed its health contract. It is distinct from
  missing configuration.

There is no Ntumba Lightning node. External Lightning channel capacity, inbound capacity, outbound
capacity and payment verification are unavailable or not configured—not zero. These values must
never be called “Ntumba liquidity.” The preferred future terms are **external Lightning channel
capacity**, **provider-reported settlement capacity**, **provider transaction limits** and **rail
availability**.

## Future read-only integrations

`@ntumba/observability` defines `ReadOnlyLightningStatusAdapter` and
`ReadOnlyProviderCapacityAdapter`. Future implementations may read sanitized node/provider health,
capacity and limits. They must not create or pay invoices, unlock a wallet, initiate settlement,
request a refund or accept a credential capable of moving funds. Adding a live adapter requires a
separate reviewed milestone.

## Alerts

Prometheus provisions conservative rules for missing targets, API/database unavailability, outbox
or event backlog older than 15 minutes, purge overdue after two hours, purge failures,
manual-review/refund-pending states and callback verification spikes. The live-rate stale rule is
guarded by `rate_mode="live"`, so it remains inactive during fake mode. No real-money alert is
claimed.

## Troubleshooting

- **Grafana cannot start:** confirm `GRAFANA_ADMIN_PASSWORD` was exported before `up` and inspect
  `docker compose --profile ops logs grafana` without posting logs publicly.
- **Prometheus target is down:** confirm `OPS_METRICS_TOKEN` existed before startup and that
  `ops-app` is healthy. Never print the token while debugging.
- **Database shows unavailable:** verify the database health and migration state; metrics return a
  safe zero snapshot and never echo the connection error.
- **Dashboard is empty:** allow two scrape intervals, confirm the `Ntumba Prometheus` datasource is
  provisioned and inspect Prometheus target logs inside the private stack.
- **Provisioning changed:** restart Grafana. Version-controlled files overwrite UI edits by design.

See [Runbooks](RUNBOOKS.md) for first-response actions. The dashboard does not change Ntumba's
non-custodial boundary: the operator observes opaque aggregate coordination state and never
controls payment funds.
