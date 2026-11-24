# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.1.0] - 2026-11-24

### Added

- `06-rate-limiting`: fixed window, sliding log, sliding window counter and token bucket compared in virtual time, and a shared PostgreSQL token bucket tested across four instances.
- `07-retries-backoff-jitter`: backoff policies under a thundering herd and an outage, retry budgets, layered retries and an HTTP retry helper with tests.
- `08-mpesa-stk-push`: M-Pesa Express integration against a local Daraja mock, naive and robust callback handling, a reconciler and unit checks.
- `09-postgres-isolation`: lost update, write skew, two-query report and contention cost experiments at each PostgreSQL isolation level.
- `10-webhooks`: Standard Webhooks style signing, a retrying sender, naive and robust receivers with an inbox table, and attack scenarios.
- `11-reconciliation`: data generator with planted problems, naive and robust reconciliation engines with scoring, and a scale run.
- `12-connection-pooling`: connection-per-request, pool size, external call and max_connections experiments.
- `13-optimistic-vs-pessimistic-locking`: pessimistic, optimistic and atomic update strategies under a contention sweep, and If-Match over HTTP.
- `14-timeouts-circuit-breakers`: a circuit breaker and a hung-dependency experiment under five policies.
- `15-distributed-locks-fencing`: lease table with fencing tokens and three write strategies for payout files under stalling workers.
- `16-proof-of-reserves`: plain and sum Merkle trees, attack scenarios on 100,000 accounts and signature proof of control.
- `17-payment-system-end-to-end`: the series' patterns combined in one system and run under eight kinds of injected failure, with invariant checks.
- `18-multi-currency-fx`: money as minor units, currency exponents, rounding and allocation, and a per-currency balanced ledger with FX revaluation.
- Categorised release notes and a `ci-passed` job that gates merges on every article.

### Changed

- Moved from `JosephNjorog/engineering-notes` to `Engineering-Notes/payment-systems`. Old links and clones redirect.
- Organisation-wide contributing guide, code of conduct, security policy and issue forms now apply alongside the files in this repository.
- Code ownership moved to the `@Engineering-Notes/maintainers` team.

## [1.0.0] - 2026-11-24

### Added

- `01-double-entry-ledger`: double-entry schema with append-only and balance triggers, concurrent withdrawal test, fee, hold, refund and FX patterns.
- `02-idempotency-keys`: payments API with idempotency keys, retry, burst, key reuse, missing key and stale lock scenarios.
- `03-transactional-outbox`: dual write versus outbox experiment with seeded failure injection and an inbox consumer.
- `04-ai-agents-eval`: tool-calling agent loop with guardrails, simulated model and pass^k evaluation harness.
- `05-stablecoin-settlement`: burn-and-mint transfer between two local chains with replay, forgery, tampering and reorg scenarios.
- Repository setup: Docker Compose for PostgreSQL 16, CI, Dependabot, issue forms, pull request template and contribution guidelines.

[Unreleased]: https://github.com/Engineering-Notes/payment-systems/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Engineering-Notes/payment-systems/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Engineering-Notes/payment-systems/releases/tag/v1.0.0
