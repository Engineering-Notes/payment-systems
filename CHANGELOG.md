# Changelog

All notable changes to this repository are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.0] - 2026-11-24

### Added

- `01-double-entry-ledger`: double-entry schema with append-only and balance triggers, concurrent withdrawal test, fee, hold, refund and FX patterns.
- `02-idempotency-keys`: payments API with idempotency keys, retry, burst, key reuse, missing key and stale lock scenarios.
- `03-transactional-outbox`: dual write versus outbox experiment with seeded failure injection and an inbox consumer.
- `04-ai-agents-eval`: tool-calling agent loop with guardrails, simulated model and pass^k evaluation harness.
- `05-stablecoin-settlement`: burn-and-mint transfer between two local chains with replay, forgery, tampering and reorg scenarios.
- Repository setup: Docker Compose for PostgreSQL 16, CI, Dependabot, issue forms, pull request template and contribution guidelines.

[Unreleased]: https://github.com/JosephNjorog/engineering-notes/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/JosephNjorog/engineering-notes/releases/tag/v1.0.0
