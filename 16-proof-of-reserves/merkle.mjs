// Merkle trees for proof of liabilities. Balances are integers in minor units (satoshis, cents).
import crypto from 'node:crypto';

const H = (...parts) => crypto.createHash('sha256').update(parts.join('|')).digest('hex');

// Each user gets a random nonce so their leaf cannot be linked to their identity by others.
export const leafHash = (userId, nonce, balance) => H('leaf', userId, nonce, balance);

// PLAIN tree: commits to every leaf, but not to the total.
export function buildPlain(leaves) {
  let level = leaves.map((l) => l.hash); const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(H('node', level[i], level[i + 1] ?? level[i]));
    levels.push(level = next);
  }
  return { root: level[0], levels };
}
export function proofPlain(tree, index) {
  const path = [];
  for (let d = 0; d < tree.levels.length - 1; d++) {
    const lvl = tree.levels[d], sib = index ^ 1;
    path.push({ hash: lvl[sib] ?? lvl[index], right: index % 2 === 0 }); index >>= 1;
  }
  return path;
}
export function verifyPlain(root, leaf, path) {
  let h = leaf;
  for (const p of path) h = p.right ? H('node', h, p.hash) : H('node', p.hash, h);
  return h === root;
}

// SUM tree (Maxwell style): every node carries the sum of its subtree, and the hash covers the sums.
const sumNode = (l, r) => ({ hash: H('node', l.hash, l.sum, r.hash, r.sum), sum: l.sum + r.sum });
const PAD = { hash: H('pad'), sum: 0 };

export function buildSum(leaves) {
  let level = leaves.map((l) => ({ hash: l.hash, sum: l.balance })); const levels = [level];
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) next.push(sumNode(level[i], level[i + 1] ?? PAD));
    levels.push(level = next);
  }
  return { root: level[0], levels };
}
export function proofSum(tree, index) {
  const path = [];
  for (let d = 0; d < tree.levels.length - 1; d++) {
    const lvl = tree.levels[d], sib = index ^ 1;
    path.push({ ...(lvl[sib] ?? PAD), right: index % 2 === 0 }); index >>= 1;
  }
  return path;
}
// A user checks: my leaf is in the tree, the root sum matches the published total,
// and (the rule that matters) no node I can see carries a negative sum.
export function verifySum(root, leaf, path, { rejectNegative = true } = {}) {
  let node = leaf;
  for (const p of path) {
    if (rejectNegative && p.sum < 0) return { ok: false, reason: 'negative sibling' };
    node = p.right ? sumNode(node, p) : sumNode(p, node);
  }
  if (node.hash !== root.hash || node.sum !== root.sum) return { ok: false, reason: 'root mismatch' };
  return { ok: true };
}
