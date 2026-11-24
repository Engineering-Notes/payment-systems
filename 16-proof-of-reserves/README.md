# 16 Proof of reserves with Merkle trees

Article: https://codemwangi.substack.com/p/proof-of-reserves-with-merkle-trees

No database and no dependencies.

| File | Purpose |
|---|---|
| `merkle.mjs` | Leaf commitments with per-user nonces; plain Merkle tree; Merkle sum tree with both child sums in each hash; proofs and verification with a negative-sum check |
| `experiment.mjs` | 100,000 accounts: understated total on a plain tree, negative fake accounts on a sum tree, omitted accounts, and secp256k1 signatures over a fresh challenge |

```bash
npm test
```

Expected: every plain-tree check passes against a 40% understated total; a -40% fake account is visible to every customer who rejects negative sums, a -1% fake account to about 1% of them; omitting 10 accounts goes unnoticed about 91% of the time when 1% of customers check. Balances are seeded, so all numbers except the random nonces and keys are identical on every run.
