// Proof of reserves, by experiment: 100,000 customer accounts, three ways an exchange can understate
// what it owes, and how often customers checking their own proofs would notice.
import crypto from 'node:crypto';
import { leafHash, buildPlain, proofPlain, verifyPlain, buildSum, proofSum, verifySum } from './merkle.mjs';

let seed = 99; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const N = 100_000;
const users = Array.from({ length: N }, (_, i) => {
  const balance = Math.floor(rand() ** 3 * 5_000_000) + 1000;            // satoshis, skewed: many small, few large
  const nonce = crypto.randomBytes(8).toString('hex');
  return { id: `user-${i}`, nonce, balance, hash: leafHash(`user-${i}`, nonce, balance) };
});
const trueTotal = users.reduce((s, u) => s + u.balance, 0);
const fmt = (sats) => (sats / 1e8).toFixed(2) + ' BTC';
console.log(`${N.toLocaleString()} accounts, true liabilities ${fmt(trueTotal)}\n`);

// 1. Plain Merkle tree: the root does not commit to the total.
{
  const t0 = performance.now(); const tree = buildPlain(users); const ms = performance.now() - t0;
  const claimed = Math.round(trueTotal * 0.6);
  let ok = 0; for (let i = 0; i < 1000; i++) { const k = Math.floor(rand() * N); if (verifyPlain(tree.root, users[k].hash, proofPlain(tree, k))) ok++; }
  console.log('1 PLAIN MERKLE TREE');
  console.log(`  built in ${ms.toFixed(0)} ms, proof length ${proofPlain(tree, 0).length} hashes`);
  console.log(`  exchange publishes the honest root and claims liabilities of ${fmt(claimed)} (40% understated)`);
  console.log(`  customer checks passed: ${ok} of 1000 sampled. Nothing in the proof refers to the total.\n`);
}

// 2. Sum tree with a hidden negative account.
{
  const honest = buildSum(users);
  if (honest.root.sum !== trueTotal) { console.error('sum tree root does not equal liabilities'); process.exit(1); }
  console.log('2 MERKLE SUM TREE');
  console.log(`  honest tree: root sum ${fmt(honest.root.sum)}, matches true liabilities: ${honest.root.sum === trueTotal}`);
  const negative = -Math.round(trueTotal * 0.4);
  // Attack A: append one fake account with a large negative balance.
  const fakeA = { id: 'fake', nonce: 'x', balance: negative, hash: leafHash('fake', 'x', negative) };
  const treeA = buildSum([...users, fakeA]);
  // Attack B: a smaller negative account (1% of liabilities) placed in the middle of the tree.
  const small = -Math.round(trueTotal * 0.01);
  const fakeB = { id: 'fake-b', nonce: 'z', balance: small, hash: leafHash('fake-b', 'z', small) };
  const leavesB = [...users]; leavesB.splice(50_000, 0, fakeB);
  const treeB = buildSum(leavesB);
  const idxB = (k) => (k < 50_000 ? k : k + 1);
  for (const [name, tree, idx] of [['A: fake account at -40% of liabilities', treeA, (k) => k], ['B: fake account at -1%, mid-tree', treeB, idxB]]) {
    let caughtNeg = 0, passed = 0;
    for (let k = 0; k < N; k++) {
      const r = verifySum(tree.root, { hash: users[k].hash, sum: users[k].balance }, proofSum(tree, idx(k)));
      if (r.ok) passed++; else if (r.reason === 'negative sibling') caughtNeg++;
    }
    const lax = Array.from({ length: 1000 }, () => Math.floor(rand() * N))
      .filter((k) => verifySum(tree.root, { hash: users[k].hash, sum: users[k].balance }, proofSum(tree, idx(k)), { rejectNegative: false }).ok).length;
    console.log(`  attack ${name}: root sum ${fmt(tree.root.sum)} (${(100 * (1 - tree.root.sum / trueTotal)).toFixed(0)}% understated)`);
    console.log(`    customers whose check ignores negative values: ${lax} of 1000 pass`);
    console.log(`    customers whose check rejects negative sums:   ${caughtNeg.toLocaleString()} of ${N.toLocaleString()} would detect it (${(100 * caughtNeg / N).toFixed(3)}%)`);
  }
  console.log('');
}

// 3. Omitted accounts: leave customers out of the tree entirely. Only an omitted customer who checks can notice.
{
  console.log('3 OMITTED ACCOUNTS: chance the exchange gets away with it, by share of customers who check their proof');
  console.log('  omitted     1% check    5% check   20% check   (simulated, 2,000 trials each)');
  for (const omitted of [10, 100, 1000]) {
    const cells = [0.01, 0.05, 0.2].map((p) => {
      let undetected = 0;
      for (let t = 0; t < 2000; t++) { let seen = false; for (let k = 0; k < omitted && !seen; k++) if (rand() < p) seen = true; if (!seen) undetected++; }
      return `${((100 * undetected) / 2000).toFixed(1)}%`.padStart(10);
    });
    console.log(`  ${String(omitted).padStart(7)}  ${cells.join('  ')}`);
  }
  console.log('');
}

// 4. The reserves side: prove control of the wallets by signing a fresh challenge.
{
  const challenge = `proof-of-reserves 2027-01-13 nonce:${crypto.randomBytes(8).toString('hex')}`;
  const wallets = Array.from({ length: 3 }, () => crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' }));
  const sigs = wallets.map((w) => crypto.sign('sha256', Buffer.from(challenge), w.privateKey));
  const valid = wallets.map((w, i) => crypto.verify('sha256', Buffer.from(challenge), w.publicKey, sigs[i])).filter(Boolean).length;
  const stolen = crypto.verify('sha256', Buffer.from(challenge), wallets[0].publicKey, crypto.sign('sha256', Buffer.from(challenge), crypto.generateKeyPairSync('ec', { namedCurve: 'secp256k1' }).privateKey));
  console.log('4 PROOF OF CONTROL: signatures over a fresh challenge');
  console.log(`  ${valid} of 3 wallet signatures verify | a signature from a key the exchange does not hold verifies: ${stolen}`);
}
