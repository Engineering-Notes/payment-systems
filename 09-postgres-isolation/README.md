# 09 PostgreSQL isolation levels, by experiment

Article: https://codemwangi.substack.com/p/postgresql-isolation-levels-by-experiment

| File | Purpose |
|---|---|
| `tx.mjs` | `inTx(pool, level, fn, { maxRetries })`: runs a transaction at an isolation level and retries the whole transaction on SQLSTATE 40001 and 40P01 |
| `experiment.mjs` | Four experiments: lost update, write skew, a two-query report during transfers, and throughput per level under contention |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/isolation` and can be overridden with `DATABASE_URL`. The script drops and creates its own tables.

Expected shape of the results (exact numbers vary with timing):

- Lost update at Read Committed with read-then-write: final balance far above 500. Repeatable Read with retries, `SELECT ... FOR UPDATE` and an atomic `UPDATE` all end at 500.
- Write skew: the rule breaks in every round at Read Committed and Repeatable Read, never at Serializable.
- Two-query report: almost every report wrong at Read Committed, none at Repeatable Read.
- Throughput: Read Committed with atomic updates is fastest; the stricter levels retry heavily on 20 hot accounts.

The script exits with an error if any of the safe approaches produces a wrong result, so it can run in CI.
