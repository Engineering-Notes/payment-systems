# 03 The transactional outbox pattern

Article: https://codemwangi.substack.com/p/the-transactional-outbox-pattern

| File | Purpose |
|---|---|
| `schema.sql` | `payments` and `outbox` tables, partial index on unpublished rows |
| `consumer-schema.sql` | Consumer `receipts` (every delivery) and `inbox` (one row per event) |
| `experiment.mjs` | 1,000 payments per scenario: commit then publish, publish then commit, and the outbox with 4 relay workers |

Failure rates are seeded: broker down 5%, acknowledgement lost 5%, crash 3%, commit failure 3%.

```bash
npm install
npm test             # relay batch size 50
npm run test:batch1  # relay batch size 1
```

Expected: commit-then-publish loses 70 events, publish-then-commit produces 75 events for payments that do not exist, and the outbox processes exactly one event per saved payment. Duplicate deliveries absorbed by the inbox vary between runs (relays run concurrently).
