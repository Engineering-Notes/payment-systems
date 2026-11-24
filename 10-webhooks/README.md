# 10 Webhooks done right

Article: https://codemwangi.substack.com/p/webhooks-done-right

| File | Purpose |
|---|---|
| `signing.mjs` | Standard Webhooks style signing and verification: HMAC-SHA256 over `id.timestamp.body`, `v1,<base64>`, constant-time compare, timestamp tolerance, several secrets for rotation |
| `sender.mjs` | Delivers one event with a timeout and exponential backoff with jitter (scaled to milliseconds) |
| `receiver.mjs` | `naive` mode (parse, work, answer) and `robust` mode (verify raw body, inbox table, answer fast, workers apply by version) |
| `schema.sql` | `webhook_inbox`, `payments`, `ledger_entries` |
| `experiment.mjs` | 660 events for 300 payments through both receivers, then 10 forged, 10 tampered and 10 replayed requests |

```bash
npm install
npm test
```

The database URL defaults to `postgres://ledger:ledger@localhost/webhooks` and can be overridden with `DATABASE_URL`.

Expected: the robust receiver ends with 0 payments in the wrong state, 0 duplicated ledger entries, the expected balance and 0 attacks accepted on every run. The naive receiver's numbers vary with timing (around 150 to 180 wrong states and 80 to 280 duplicated entries). The script exits with an error if the robust receiver is ever wrong.
