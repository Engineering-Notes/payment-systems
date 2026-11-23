# 05 How stablecoin transfers actually settle

Article: https://codemwangi.substack.com/p/how-stablecoin-transfers-actually

| File | Purpose |
|---|---|
| `contracts.sol` | `StableToken`, `BurnMessenger` (source chain), `MintTransmitter` (destination chain, attester signature and nonce checks) |
| `test.mjs` | Compiles the contracts, starts two Ganache chains, runs the attester and six scenarios |

```bash
npm install
npm test
```

Expected: a normal transfer keeps total supply at 1,000; replay, forged signature and altered amount are rejected; an attestation signed at 0 confirmations followed by a reorg leaves 200 unbacked tokens; an attester that waits for finality never signs the orphaned burn.

Notes: contracts compile for the `paris` EVM version because Ganache does not support newer opcodes. Finality is modelled as 64 blocks of depth; production code should read the chain's finalised block tag.

Maintainer note: Ganache ships a bundled lock entry for `fsevents`, a macOS-only package that npm never installs. It is removed from `package-lock.json` so that `npm ci` works on Linux and in CI. If you regenerate the lockfile, remove that entry again.
