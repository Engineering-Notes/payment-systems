# Engineering Notes

[![CI](https://github.com/JosephNjorog/engineering-notes/actions/workflows/ci.yml/badge.svg)](https://github.com/JosephNjorog/engineering-notes/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22](https://img.shields.io/badge/node-22-339933.svg)](.nvmrc)
[![PostgreSQL 16](https://img.shields.io/badge/postgresql-16-336791.svg)](docker-compose.yml)

Tested code behind the **Engineering Notes** series on [codemwangi.substack.com](https://codemwangi.substack.com), by [Joseph Mwangi](https://github.com/JosephNjorog).

Each article makes claims about how a system behaves under concurrency, retries, crashes or adversarial input. This repository is where those claims are measured. Every number quoted in an article is produced by the code in its folder, and CI runs all of it on every change.

## Articles

| No. | Article | Code | What it measures |
|---|---|---|---|
| 01 | [Double-entry ledgers for software engineers](https://codemwangi.substack.com/p/double-entry-ledgers-for-software) | [`01-double-entry-ledger`](01-double-entry-ledger) | 50 concurrent withdrawals against a balance column and a ledger; fees, holds, refunds and FX as balanced entries |
| 02 | [Idempotency keys for payment APIs](https://codemwangi.substack.com/p/idempotency-keys-for-payment-apis) | [`02-idempotency-keys`](02-idempotency-keys) | Lost responses, retry storms, reused keys and crashed workers, with and without keys |
| 03 | [The transactional outbox pattern](https://codemwangi.substack.com/p/the-transactional-outbox-pattern) | [`03-transactional-outbox`](03-transactional-outbox) | 1,000 payments under injected failures: dual writes against the outbox, relay batching and an inbox consumer |
| 04 | [Tool-calling AI agents in production](https://codemwangi.substack.com/p/tool-calling-ai-agents-in-production) | [`04-ai-agents-eval`](04-ai-agents-eval) | pass^k for an agent under four guardrail configurations, judged on final state |
| 05 | [How stablecoin transfers actually settle](https://codemwangi.substack.com/p/how-stablecoin-transfers-actually) | [`05-stablecoin-settlement`](05-stablecoin-settlement) | Burn-and-mint across two chains: replay, forgery, tampering and an attestation signed before finality |

## Quick start

Requirements: [Node.js 22](.nvmrc) and Docker.

```bash
git clone https://github.com/JosephNjorog/engineering-notes.git
cd engineering-notes
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
