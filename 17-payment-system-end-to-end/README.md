# 17 Designing a payment system end to end

Article: https://codemwangi.substack.com/p/designing-a-payment-system-end-to

| File | Purpose |
|---|---|
| `schema.sql` | Rate limits, idempotency keys, payments, double-entry ledger, outbox, inbox |
| `system.mjs` | Provider mock, payments API, outbox relay, webhook receiver and reconciler in one process, with fault injection |
| `experiment.mjs` | 600 payments from 20 customers; prints faults injected, what absorbed them, and seven invariants |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/e2e` and can be overridden with `DATABASE_URL`. A run takes 15 to 30 seconds.

Faults: lost API responses, rate limiting, provider hangs, provider errors after charging, relay crashes after the provider call, lost and duplicated webhooks, and a forged webhook. The script exits with an error if any of the seven invariants fails: every request accepted, one payment per request, one provider charge per payment, every charge captured, two ledger entries per payment, ledger balances to zero, ledger total equals provider total.
