# 01 Double-entry ledgers for software engineers

Article: https://codemwangi.substack.com/p/double-entry-ledgers-for-software

| File | Purpose |
|---|---|
| `schema.sql` | Accounts, journal entries, postings, cached balances, append-only and balance triggers, `post_entry`, `reverse_entry`, `balance_at` |
| `race-test.mjs` | 50 concurrent withdrawals of KES 300 against a KES 10,000 wallet, naive balance column vs the ledger, plus retry, immutability and balance checks |
| `patterns.sql` | Fee split, hold and capture, refund by reversal, KES to USD conversion through clearing accounts |

```bash
npm install
npm test            # runs race-test.mjs (loads schema.sql itself)
npm run patterns    # run after npm test; needs psql
```

Expected ledger result on every run: 33 withdrawals succeed, 17 are rejected, the wallet ends at KES 100, and debits minus credits across the ledger is 0. The naive version approves all 50 and its stored balance varies by run.
