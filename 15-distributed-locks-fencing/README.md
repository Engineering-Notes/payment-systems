# 15 Distributed locks and fencing tokens

Article: https://codemwangi.substack.com/p/distributed-locks-and-fencing-tokens

| File | Purpose |
|---|---|
| `schema.sql` | `leases` with a token sequence, `payout_files` with `max_token` and `sent_count`, `payout_writes` log |
| `lease.mjs` | Acquire a lease (free or expired) with a new fencing token, release, check validity |
| `experiment.mjs` | 4 workers, 200 payout files, 100 ms leases, 15% of holders stall 250 ms; three write strategies |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/fencing` and can be overridden with `DATABASE_URL`.

Expected: lease only sends around 25 files twice; lease plus fencing token around 8; fencing plus send-once sends every file exactly once. Exact counts vary slightly with timing. The script exits with an error if the last strategy sends any file twice or misses one.
