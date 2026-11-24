# 18 Multi-currency and FX in the ledger

Article: https://codemwangi.substack.com/p/multi-currency-and-fx-in-the-ledger

| File | Purpose |
|---|---|
| `money.mjs` | ISO 4217 exponents, decimal string to minor units, integer currency conversion with half-even or half-up rounding, largest-remainder allocation |
| `schema.sql` | Ledger entries with a currency column and a deferred trigger requiring every transaction to balance per currency |
| `experiment.mjs` | Float summation, hard-coded x100 across KES, JPY and BHD, 100,000 conversions under three rounding modes, a three-way split, and an FX conversion with month-end revaluation |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/fx` and can be overridden with `DATABASE_URL`. Results are deterministic. The script exits with an error if any currency fails to sum to zero across the ledger.
