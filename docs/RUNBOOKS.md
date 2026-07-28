# Operator Runbooks

Never delete or silently reinitialize the PostgreSQL volume during incident response. A volume
created by a pre-18 major release requires a reviewed `pg_upgrade` before PostgreSQL 18 can use it.

These are first-response steps for the private development dashboard. Preserve opaque records and
never paste destinations, payer details, callback bodies, tokens or database URLs into tickets or
chat.

## API down

1. Confirm the private target and public `/api/health` fail from their expected networks.
2. Inspect container status and redacted server logs for an error type.
3. Restore the same build/configuration; do not retry unknown payment outcomes blindly.
4. Reconcile affected opaque source/destination references before communicating status.

## Database down

1. Confirm the database health check and storage availability.
2. Stop creating new bridge intents if durable writes cannot be guaranteed.
3. Restore connectivity or a tested backup; never rebuild payment state from merchant data.
4. Verify migrations and aggregate counts before resuming.

## Stale rate

1. Confirm the alert is live-mode only; fake mode intentionally has no fresh rate.
2. Disable affected quote creation through the future reviewed circuit breaker.
3. Check the read-only rate adapter and source timestamp.
4. Resume only after freshness checks pass. Do not substitute the development static rate.

## Liquidity rail unavailable

1. Stop creating intents for the affected direction through a reviewed control outside this
   read-only dashboard.
2. Preserve opaque rail references, normalized timestamps, reservations and journal records.
3. Reconcile source collection, destination obligation and rail reports independently.
4. Resume only after rail health, inventory and reconciliation agree.

## Callback verification failures

1. Compare the bounded reason: signature, timestamp, malformed, mismatch or conflict.
2. Check clock synchronization and the configured callback secret without printing either secret
   or callback body.
3. Confirm provider endpoint/configuration changes through an authenticated channel.
4. Treat conflicts and amount/direction mismatches as incidents; do not insert the event manually.

## Pending event backlog

1. Confirm count and oldest age; provider events are normalized but currently unprocessed by
   design.
2. Compare opaque event IDs with rail reporting outside metrics.
3. Do not mutate payment state until the event-processing/reconciliation milestone exists.
4. Escalate growing or old backlogs and preserve retention windows.

## Pending outbox backlog

1. Check count, oldest age, attempt bucket and safe failure category.
2. Remember rows contain no destination and cannot dispatch autonomously.
3. A retry requires the client to resubmit the transient destination with the same idempotency key.
4. Reconcile unknown source or destination outcomes before retrying.

## Purge overdue

1. Confirm jobs are enabled and the last scheduled-purge timestamp is older than two hours.
2. Inspect pg-boss and database errors without exposing connection strings.
3. Repair the job and verify eligible-record counts fall after a successful run.
4. Do not shorten production retention without provider/legal/accounting review.

## Manual-review payment

1. Identify the payment only through approved opaque operational records, never metrics labels.
2. Compare normalized Ntumba state with source/destination rail evidence and journal entries.
3. Do not declare settlement or retry an unknown outcome without reconciliation.
4. Record the confirmed resolution through a future reviewed state-transition workflow.

## Refund required or pending

1. Confirm source funds settled and identify the operator refund obligation and asset.
2. Track only opaque rail references outside metrics under restricted access.
3. Do not retry an uncertain destination or issue a duplicate refund.
4. Communicate only reconciled status and escalate any liquidity or provider shortfall.
