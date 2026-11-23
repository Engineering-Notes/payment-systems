# 02 Idempotency keys for payment APIs

Article: https://codemwangi.substack.com/p/idempotency-keys-for-payment-apis

| File | Purpose |
|---|---|
| `schema.sql` | `payments` and `idempotency_keys` tables |
| `server.mjs` | HTTP API with `/naive/payments` (no protection) and `/v1/payments` (Idempotency-Key required) |
| `test.mjs` | Lost response with retry, 20 identical requests at once, key reused with a different body, missing key |
| `crash-test.mjs` | A worker that claimed a key and crashed; the next retry takes over the stale lock |

```bash
npm install
npm test
```

Expected: the naive endpoint creates 2 payments after one retry and 20 after a burst of 20; the keyed endpoint creates 1 in every scenario, returns 409 while in progress, 422 on a reused key with a different body and 400 without a key.
