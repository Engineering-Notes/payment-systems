# 11 Reconciliation engines

Article: https://codemwangi.substack.com/p/reconciliation-engines

| File | Purpose |
|---|---|
| `schema.sql` | `internal_txns`, `provider_rows` (gross, fee, net, payout), `bank_lines`, `recon_results` |
| `generate.mjs` | Three days of charges and refunds with planted problems: missing on either side, amount mismatches, internal duplicates, a short payout; plus fees and cut-off timing that are not problems |
| `engines.mjs` | Naive engine (per day, by reference, net or gross) and robust engine (gross, aggregate first, cut-off grace window, payout level), plus scoring |
| `experiment.mjs` | Scores three engines on about 6,100 rows a side, then runs the robust engine on about 610,000 rows a side |

```bash
npm install
npm test          # includes the 600,000-row scale run (about a minute to generate)
npm run test:quick  # skips the scale run
```

The database URL defaults to `postgres://ledger:ledger@localhost/recon` and can be overridden with `DATABASE_URL`. Data is generated from a fixed seed, so results are identical on every run.

Expected: naive with net reports 6,000 breaks (5,931 false); naive with gross reports 380 (325 false, 15 missed); robust reports exactly the 70 planted problems. The script exits with an error if the robust engine is ever wrong.
