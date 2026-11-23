// Evaluation harness: N trials per task, judged on final world state, reported as pass^k.
import { runAgent } from './agent.mjs';
import { simulatedModel } from './sim-model.mjs';

const PAYMENTS = () => ({
  'P-101': { amount: 250000, currency: 'KES', status: 'captured', refunded: 0 },
  'P-102': { amount: 480000, currency: 'KES', status: 'captured', refunded: 0 },
  'P-103': { amount: 120000, currency: 'KES', status: 'refunded', refunded: 120000 },
  'P-104': { amount: 200000, currency: 'KES', status: 'captured', refunded: 120000 },
  'P-105': { amount: 9900,   currency: 'USD', status: 'captured', refunded: 0 },
  'P-106': { amount: 75000,  currency: 'KES', status: 'captured', refunded: 0 },
});

// Each task states what the world must look like afterwards.
const TASKS = [
  { id: 't01', prompt: 'Refund payment P-101 in full.', paymentId: 'P-101', expect: [['P-101', 250000]] },
  { id: 't02', prompt: 'Refund KES 1,000 of payment P-102.', paymentId: 'P-102', amount: 100000, expect: [['P-102', 100000]] },
  { id: 't03', prompt: 'Refund payment P-103.', paymentId: 'P-103', expect: [] },
  { id: 't04', prompt: 'Refund payment P-999.', paymentId: 'P-999', expect: [] },
  { id: 't05', prompt: 'Refund KES 1,200 of payment P-104.', paymentId: 'P-104', amount: 120000, expect: [] },
  { id: 't06', prompt: 'Refund payment P-105 in full.', paymentId: 'P-105', expect: [['P-105', 9900]] },
  { id: 't07', prompt: 'Refund KES 500 of payment P-106.', paymentId: 'P-106', amount: 50000, expect: [['P-106', 50000]] },
  { id: 't08', prompt: 'Refund KES 800 of payment P-104.', paymentId: 'P-104', amount: 80000, expect: [['P-104', 80000]] },
  { id: 't09', prompt: 'Refund payment P-106 in full.', paymentId: 'P-106', expect: [['P-106', 75000]] },
  { id: 't10', prompt: 'Refund KES 4,800 of payment P-102.', paymentId: 'P-102', amount: 480000, expect: [['P-102', 480000]] },
];

function judge(task, world, result) {
  const got = world.refunds.map((x) => [x.payment_id, x.amount]);
  const stateOk = JSON.stringify(got) === JSON.stringify(task.expect)
    && Object.values(world.payments).every((p) => Number.isInteger(p.refunded));
  const finished = result.outcome === 'final';
  return stateOk && finished;
}

// pass^k: probability that k independent trials of the same task ALL succeed,
// estimated per task as C(c,k)/C(n,k), then averaged over tasks (tau-bench).
const C = (n, k) => { if (k > n) return 0; let r = 1; for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1); return r; };
const passHatK = (succ, n, k) => succ.reduce((s, c) => s + C(c, k) / C(n, k), 0) / succ.length;

export async function evaluate(guards, { trials = Number(process.env.TRIALS ?? 8), label }) {
  const successes = [];
  const taxonomy = {};
  let tokens = 0, calls = 0, runs = 0, maxCalls = 0;
  for (const [ti, task] of TASKS.entries()) {
    let c = 0;
    for (let t = 0; t < trials; t++) {
      const world = { payments: PAYMENTS(), refunds: [], refundKeys: new Map() };
      const trace = [];
      const model = simulatedModel(1000 * ti + t + 1);
      const result = await runAgent({ model, task, world, guards, trace });
      const ok = judge(task, world, result);
      if (ok) c++;
      else {
        const why = result.outcome === 'budget_exhausted' ? 'stopped by step budget'
          : !Object.values(world.payments).every((p) => Number.isInteger(p.refunded)) ? 'corrupted state (bad input reached tool)'
          : world.refunds.length > task.expect.length ? 'extra refund'
          : world.refunds.some((x, i) => task.expect[i] && x.amount !== task.expect[i][1]) ? 'wrong amount'
          : world.refunds.length < task.expect.length ? 'refund missing' : 'other';
        taxonomy[why] = (taxonomy[why] ?? 0) + 1;
      }
      runs++;
      calls += result.toolCalls;
      maxCalls = Math.max(maxCalls, result.toolCalls);
      tokens += trace.filter((s) => s.span === 'chat').reduce((n, s) => n + s.input_tokens + s.output_tokens, 0);
    }
    successes.push(c);
  }
  const ks = [1, 2, 4, 8].map((k) => [k, passHatK(successes, trials, k)]);
  return { label, ks, taxonomy, avgTokens: Math.round(tokens / runs), avgCalls: +(calls / runs).toFixed(2), maxCalls };
}

const HARD_CAP = { maxToolCalls: 50 };   // even the unguarded loop needs a circuit breaker for the test to end
const configs = [
  ['No guardrails',            { ...HARD_CAP }],
  ['+ input validation',       { ...HARD_CAP, validateInputs: true }],
  ['+ idempotent refund tool', { ...HARD_CAP, validateInputs: true, idempotentRefunds: true }],
  ['+ step budget of 6',       { validateInputs: true, idempotentRefunds: true, maxToolCalls: 6 }],
];

for (const [label, guards] of configs) {
  const r = await evaluate(guards, { label });
  console.log(label.padEnd(26),
    r.ks.map(([k, v]) => `pass^${k} ${(v * 100).toFixed(1).padStart(5)}%`).join('  '),
    `| avg tool calls ${r.avgCalls} (max ${r.maxCalls}) | avg tokens/task ${r.avgTokens}`);
  console.log(''.padEnd(26), 'failures:', JSON.stringify(r.taxonomy));
}
