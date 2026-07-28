# Security

## Fund safety

- Merchants have no Ntumba account, balance, deposit wallet or stored-value claim.
- Direct BTC → BTC uses a merchant-owned invoice, is never silently replaced and never passes
  through operator liquidity.
- Conversion is custodial during settlement: BTC → ZMW uses operator-controlled Bitcoin then
  operator ZMW; ZMW → BTC uses operator-controlled ZMW then operator Bitcoin.
- Destination liquidity must be reserved before source acceptance. Destination settlement cannot
  begin until source settlement is conclusive and cannot execute twice.
- Collection and settlement use distinct idempotency keys. Confirmed retries reuse the original
  key; timeout or unknown outcome enters manual review.
- Each asset-specific journal transaction is append-only and debit/credit balanced. BTC and ZMW
  exchange entries are linked but never falsely balanced against each other.
- Integer-only amounts, short quote expiry and idempotency apply to every request.
- The bridge is disabled by default. Fake mode is rejected in production and contains no external
  call path or real credentials.

## Privacy boundary

Merchant destinations and payer details must not enter logs, errors, traces, analytics or
PostgreSQL. Request bodies are not logged. Unexpected server errors record an error type only.
Provider adapters must scrub upstream errors before returning them.

The server does see a merchant destination transiently during intent creation. TLS,
restricted process access and careful crash/debug tooling are therefore required.

The outbox is intentionally payload-free. The current destination vault is development-only,
in-memory and expiring. Production requires provider-issued opaque beneficiary tokenization or a
reviewed short-lived envelope-encrypted store with automatic deletion. Destination loss after
source settlement creates a refund/manual-review obligation.

## Provider callbacks

- The fake-provider route verifies an HMAC-SHA256 signature against the timestamp and exact raw
  body bytes in memory. `FAKE_PROVIDER_CALLBACK_SECRET` must contain at least 32 characters to
  enable verification; absent configuration fails closed without preventing other development use.
- Timestamps outside a five-minute tolerance are rejected. Identical event retries are idempotent;
  conflicting reuse of a provider event ID is rejected.
- Normalization happens only after signature verification. Persistence contains provider event ID,
  payload hash, normalized status and lifecycle timestamps, never the raw body.
- Provider reference, direction, source/settlement assets and integer amounts must match the
  original intent and quote before insertion.

## Browser data and links

IndexedDB contains merchant personal data. It is not cloud-backed or encrypted by Ntumba; device
security and browser-origin security protect it. The clear-data action removes Ntumba's store.

The service worker must keep its public-shell allowlist explicit. It bypasses `/api` and does not
cache navigations, checkout projections or payment state. Offline UI must never infer settlement
from cached data and instead requires a fresh provider confirmation after reconnection.

Checkout fragments are not sent in HTTP requests but are bearer information. Users should avoid
posting links publicly, and the app must not load third-party analytics/resources that can inspect
the fragment.

## Operator observability boundary

Operational endpoints use a separate listener, are disabled by default and require a 32+ character
bearer token whenever enabled. Container deployments read the token from a Compose secret. The
public port and merchant bundle contain no operator route or credential. Internal authorization
headers are redacted, tokens are compared in constant time and database failures return no error
detail. Prometheus and the internal port are not published; Grafana binds to `127.0.0.1`, disables
anonymous access/sign-up/analytics, update checks and suggested-plugin preinstallation, and
receives its admin password from a secret. This avoids routine outbound Grafana catalog requests.

The dashboard is read-only. Its fake balance and capacity metrics do not authorize payment.
Read-only observability adapters must never accept an LND admin
macaroon, wallet seed/unlock credential or expose invoice-payment, disbursement, refund or service
pause methods. Future remote access should use separately administered Tailscale Serve within the
operator tailnet, never a public Funnel/tunnel.

## Launch gates

Before real funds: complete provider security and counterparty review, least-privilege credential
design, callback fixtures, penetration testing, dependency/secret scanning, treasury
reconciliation, backup/restore and incident exercises, capital/liquidity/refund limits, privacy
and retention decisions, and qualified Zambian custody/safeguarding, payment-services, AML/KYC,
consumer, tax and regulatory review.

## Automated scanning

- `yarn audit:dependencies` checks every workspace and transitive package against the npm advisory
  registry and fails for high or critical findings.
- GitHub Actions runs the dependency audit and a redacted Gitleaks full-history scan on pushes,
  pull requests, manual dispatches and a weekly schedule.
- The security workflow has read-only repository contents permission. Gitleaks is pinned to an
  immutable action commit and does not post pull-request comments or upload findings as artifacts.
- `.gitleaks.toml` extends the default rules. Its only allowlist requires both an exact deterministic
  idempotency fixture value and one of three named payment test files; test directories are not
  excluded wholesale.
- GitHub-native secret scanning should also be enabled in repository settings if the repository's
  visibility and plan support it.
