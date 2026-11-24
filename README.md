# Engineering Notes: Payment Systems

[![CI](https://github.com/Engineering-Notes/payment-systems/actions/workflows/ci.yml/badge.svg)](https://github.com/Engineering-Notes/payment-systems/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/node-22-339933.svg)](.nvmrc)
[![PostgreSQL 16](https://img.shields.io/badge/postgresql-16-336791.svg)](docker-compose.yml)

Tested code behind the **Payment Systems** series of [Engineering Notes](https://github.com/Engineering-Notes), published on [codemwangi.substack.com](https://codemwangi.substack.com) and written by [Joseph Mwangi](https://github.com/JosephNjorog).

Other series in the organisation: [Distributed Systems](https://github.com/Engineering-Notes/distributed-systems) (from January 2027) and [AI Engineering](https://github.com/Engineering-Notes/ai-engineering) (from February 2027).

Each article makes claims about how a system behaves under concurrency, retries, crashes or adversarial input. This repository is where those claims are measured. Every number quoted in an article is produced by the code in its folder, and CI runs all of it on every change.

## Articles

| No. | Article | Code | What it measures |
|---|---|---|---|
| 01 | [Double-entry ledgers for software engineers](https://codemwangi.substack.com/p/double-entry-ledgers-for-software) | [`01-double-entry-ledger`](01-double-entry-ledger) | 50 concurrent withdrawals against a balance column and a ledger; fees, holds, refunds and FX as balanced entries |
| 02 | [Idempotency keys for payment APIs](https://codemwangi.substack.com/p/idempotency-keys-for-payment-apis) | [`02-idempotency-keys`](02-idempotency-keys) | Lost responses, retry storms, reused keys and crashed workers, with and without keys |
| 03 | [The transactional outbox pattern](https://codemwangi.substack.com/p/the-transactional-outbox-pattern) | [`03-transactional-outbox`](03-transactional-outbox) | 1,000 payments under injected failures: dual writes against the outbox, relay batching and an inbox consumer |
| 04 | [Tool-calling AI agents in production](https://codemwangi.substack.com/p/tool-calling-ai-agents-in-production) | [`04-ai-agents-eval`](04-ai-agents-eval) | pass^k for an agent under four guardrail configurations, judged on final state |
| 05 | [How stablecoin transfers actually settle](https://codemwangi.substack.com/p/how-stablecoin-transfers-actually) | [`05-stablecoin-settlement`](05-stablecoin-settlement) | Burn-and-mint across two chains: replay, forgery, tampering and an attestation signed before finality |
| 06 | [Rate limiting payment APIs](https://codemwangi.substack.com/p/rate-limiting-payment-apis) | [`06-rate-limiting`](06-rate-limiting) | Four limiting algorithms under boundary bursts and overload; per-instance limits against a shared PostgreSQL token bucket |
| 07 | [Retries, backoff and jitter](https://codemwangi.substack.com/p/retries-backoff-and-jitter) | [`07-retries-backoff-jitter`](07-retries-backoff-jitter) | Thundering herd, outage and layered retries under five backoff policies; retry budgets; an HTTP retry helper |
| 08 | [M-Pesa STK Push, end to end](https://codemwangi.substack.com/p/m-pesa-stk-push-end-to-end) | [`08-mpesa-stk-push`](08-mpesa-stk-push) | 200 checkouts against a Daraja mock with lost, duplicate, late and forged callbacks |
| 09 | [PostgreSQL isolation levels, by experiment](https://codemwangi.substack.com/p/postgresql-isolation-levels-by-experiment) | [`09-postgres-isolation`](09-postgres-isolation) | Lost updates, write skew and inconsistent reports at each isolation level, and the cost of each fix |
| 10 | [Webhooks done right](https://codemwangi.substack.com/p/webhooks-done-right) | [`10-webhooks`](10-webhooks) | 660 signed deliveries through naive and robust receivers, plus forged, tampered and replayed requests |
| 11 | [Reconciliation engines](https://codemwangi.substack.com/p/reconciliation-engines) | [`11-reconciliation`](11-reconciliation) | Ledger, provider report and bank reconciliation with 70 planted problems, and a 600,000-row run |
| 12 | [Connection pooling under load](https://codemwangi.substack.com/p/connection-pooling-under-load) | [`12-connection-pooling`](12-connection-pooling) | Per-request connections, pool size sweep, external calls in transactions, max_connections when scaling out |
| 13 | [Optimistic vs pessimistic locking](https://codemwangi.substack.com/p/optimistic-vs-pessimistic-locking) | [`13-optimistic-vs-pessimistic-locking`](13-optimistic-vs-pessimistic-locking) | Three update strategies from 1 to 10,000 contended rows, and If-Match over HTTP |
| 14 | [Timeouts and circuit breakers](https://codemwangi.substack.com/p/timeouts-and-circuit-breakers) | [`14-timeouts-circuit-breakers`](14-timeouts-circuit-breakers) | A hung dependency under five policies, from no timeout to a breaker with a fallback |
| 15 | [Distributed locks and fencing tokens](https://codemwangi.substack.com/p/distributed-locks-and-fencing-tokens) | [`15-distributed-locks-fencing`](15-distributed-locks-fencing) | Leases, fencing tokens and send-once writes for 200 payout files with stalling workers |
| 16 | [Proof of reserves with Merkle trees](https://codemwangi.substack.com/p/proof-of-reserves-with-merkle-trees) | [`16-proof-of-reserves`](16-proof-of-reserves) | Plain and sum Merkle trees on 100,000 accounts, three ways to understate liabilities, proof of control |
| 17 | [Designing a payment system end to end](https://codemwangi.substack.com/p/designing-a-payment-system-end-to) | [`17-payment-system-end-to-end`](17-payment-system-end-to-end) | The series in one system: 600 payments under eight failure types, with seven invariants |
| 18 | [Multi-currency and FX in the ledger](https://codemwangi.substack.com/p/multi-currency-and-fx-in-the-ledger) | [`18-multi-currency-fx`](18-multi-currency-fx) | Minor units, rounding, allocation and a per-currency balanced ledger with FX revaluation |

## Quick start

Requirements: [Node.js 22](.nvmrc) and Docker.

```bash
git clone https://github.com/Engineering-Notes/payment-systems.git
cd payment-systems
docker compose up -d                 # PostgreSQL 16 for articles 01 to 03

cd 01-double-entry-ledger
npm ci
npm test
```

Articles 04 and 05 need no database. Each folder README lists its files, its commands and the exact output to expect.

## Repository layout

```text
.
├── 01-double-entry-ledger/      article 01, PostgreSQL
├── 02-idempotency-keys/         article 02, PostgreSQL
├── 03-transactional-outbox/     article 03, PostgreSQL
├── 04-ai-agents-eval/           article 04, Node.js only
├── 05-stablecoin-settlement/    article 05, Solidity on local Ganache chains
├── 06-rate-limiting/            article 06, PostgreSQL
├── 07-retries-backoff-jitter/   article 07, Node.js only
├── 08-mpesa-stk-push/           article 08, PostgreSQL
├── 09-postgres-isolation/       article 09, PostgreSQL
├── 10-webhooks/                 article 10, PostgreSQL
├── 11-reconciliation/           article 11, PostgreSQL
├── 12-connection-pooling/       article 12, PostgreSQL
├── 13-optimistic-vs-pessimistic-locking/article 13, PostgreSQL
├── 14-timeouts-circuit-breakers/article 14, Node.js only
├── 15-distributed-locks-fencing/article 15, PostgreSQL
├── 16-proof-of-reserves/        article 16, Node.js only
├── 17-payment-system-end-to-end/ article 17, PostgreSQL
├── 18-multi-currency-fx/        article 18, PostgreSQL
├── docker/                      database initialisation
├── docker-compose.yml           PostgreSQL 16 for local runs
└── .github/                     CI, Dependabot, issue forms, PR template
```

Each article folder is a self-contained Node.js project with its own lockfile, so one article's dependencies never affect another's results.

## Configuration

| Variable | Used by | Default |
|---|---|---|
| `DATABASE_URL` | 01, 02 | `postgres://ledger:ledger@localhost/ledger` and `.../idem` |
| `APP_DATABASE_URL` | 03 | `postgres://ledger:ledger@localhost/outbox` |
| `CONSUMER_DATABASE_URL` | 03 | `postgres://ledger:ledger@localhost/consumer` |
| `ANTHROPIC_API_KEY`, `MODEL` | 04, only to evaluate a real model | unset |

See [`.env.example`](.env.example).

## Principles

- **Measured, not asserted.** If an article states a number, a script in this repository prints it.
- **Reproducible.** Randomised experiments use fixed seeds. Where concurrency makes a result vary, the README gives the observed range.
- **Minimal.** Each folder contains the smallest code that demonstrates the pattern faithfully. These are teaching implementations, not production libraries.

## Contributing

Corrections, new scenarios and bug reports are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) first, and use the issue forms. Security reports go through [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © 2026 Joseph Mwangi
