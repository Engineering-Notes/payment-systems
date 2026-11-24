# 08 M-Pesa STK Push, end to end

Article: https://codemwangi.substack.com/p/m-pesa-stk-push-end-to-end

The experiment runs against `daraja-mock.mjs`, a local stand-in for Safaricom's Daraja M-Pesa Express API that follows the documented request, callback and query formats. It is not Safaricom's service. Test against the Daraja sandbox before going live.

| File | Purpose |
|---|---|
| `schema.sql` | `payments` (unique checkout id and receipt, partial index on pending), `mpesa_callbacks` log, `fulfilments` |
| `daraja-mock.mjs` | OAuth, STK push and STK query endpoints; scripted outcomes and faults per phone number |
| `daraja-client.mjs` | Cached OAuth token, STK push, STK query, phone normalisation |
| `app.mjs` | Merchant app in two modes: `naive` (tutorial style) and `robust` (resolve once, confirm by query, reconcile, secret callback path) |
| `experiment.mjs` | 200 checkouts with lost, duplicate, late and forged callbacks, run in both modes |
| `unit.mjs` | Phone normalisation and a check that the STK password reveals the passkey |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/mpesa` and can be overridden with `DATABASE_URL`.

Expected: the naive app records 130 of 140 payments, leaves 16 pending, fulfils 10 orders twice and 6 unpaid; the robust app records 140 of 140 and 60 of 60 failures with nothing pending, duplicated or unpaid. The naive split between forged callbacks that end as paid and as failed depends on timing; the six unpaid fulfilments do not.

Credentials in `daraja-mock.mjs` are placeholders for the mock. Real Daraja credentials belong in environment variables, never in code.
