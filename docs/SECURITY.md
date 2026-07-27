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

## Provider callbacks

- Verify signatures against the raw body in memory.
- Reject stale timestamps and replayed event IDs where supported.
- Normalize before persistence.
- Persist only provider event ID, payload hash, normalized status and timestamps.
- Never store the raw body.
- Match provider reference, direction, amounts and assets to the original intent.

## Browser data and links

IndexedDB contains merchant personal data. It is not cloud-backed or encrypted by Ntumba; device
security and browser-origin security protect it. The clear-data action removes Ntumba's store.

Checkout fragments are not sent in HTTP requests but are bearer information. Users should avoid
posting links publicly, and the app must not load third-party analytics/resources that can inspect
the fragment.

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
