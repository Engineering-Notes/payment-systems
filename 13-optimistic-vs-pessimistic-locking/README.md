# 13 Optimistic vs pessimistic locking

Article: https://codemwangi.substack.com/p/optimistic-vs-pessimistic-locking

| File | Purpose |
|---|---|
| `strategies.mjs` | `pessimistic` (`SELECT ... FOR UPDATE`), `optimistic` (version column, bounded retries with jittered backoff), `atomic` (rule in the `WHERE` clause) |
| `experiment.mjs` | Contention sweep over 1, 10, 100 and 10,000 rows with 40 workers, then two clients editing one record over HTTP with and without `If-Match` |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/locking` and can be overridden with `DATABASE_URL`.

Expected shape: on one hot row pessimistic and optimistic run at similar speed but optimistic retries thousands of times; pessimistic wins at 10 rows; they are close at 100; optimistic wins at 10,000; atomic is fastest at every level. The HTTP test shows a silent lost update without `If-Match` and a 412 with it. The script exits with an error if any strategy loses or duplicates a write.
