# Security

## Fund safety

- Ntumba has no account balances, deposits, wallets, treasury or payment-gateway funds.
- Bridge collection and merchant settlement are provider-owned.
- Direct Bitcoin uses a merchant-owned invoice and is never silently replaced.
- Integer-only amounts, short quote expiry and idempotency apply to every request.
- Unknown provider outcomes require reconciliation before retry.

## Privacy boundary

Merchant destinations and payer details must not enter logs, errors, traces, analytics or
PostgreSQL. Request bodies are not logged. Unexpected server errors record an error type only.
Provider adapters must scrub upstream errors before returning them.

The server does see a merchant destination transiently during provider-intent creation. TLS,
restricted process access and careful crash/debug tooling are therefore required.

The provider-intent outbox is intentionally payload-free. It stores no raw, encrypted or hashed
destination. Recovery requires the client to resubmit the destination with the same idempotency
key; a future autonomous worker requires a reviewed provider-side opaque tokenization capability.

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

The dashboard is read-only. Read-only observability adapters must never accept an LND admin
macaroon, wallet seed/unlock credential or expose invoice-payment, disbursement, refund or service
pause methods. Future remote access should use separately administered Tailscale Serve within the
operator tailnet, never a public Funnel/tunnel.

## Launch gates

Before real funds: complete provider security review, callback fixtures, penetration testing,
dependency/secret scanning, privacy review, data-retention decision, incident exercises and
qualified Zambian legal/regulatory review.

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
