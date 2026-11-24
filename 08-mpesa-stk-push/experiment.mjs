// 200 checkouts against the Daraja mock, with scripted customer outcomes and delivery faults,
// run once with the naive integration and once with the robust one.
import fs from 'node:fs';
import pg from 'pg';
import { startDarajaMock, CREDS } from './daraja-mock.mjs';
import { startApp } from './app.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/mpesa', max: 20 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const N = 200;

// Customer i: outcome and fault. Deterministic.
function plan(i) {
  const code = i < 140 ? 0 : i < 160 ? 1032 : i < 176 ? 1037 : i < 184 ? 2001 : i < 192 ? 1 : 1019;
  const fault = code === 0 ? (i % 14 === 0 ? 'lost' : i % 14 === 1 ? 'duplicate' : i % 14 === 2 ? 'late' : null) : (i % 8 === 0 ? 'lost' : null);
  return { code, fault };
}
const phoneOf = (i) => `07${String(10000000 + i).padStart(8, '0')}`;           // 0710000000, 0710000001, ...
const truth = Array.from({ length: N }, (_, i) => plan(i));

async function run(mode) {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const mock = await startDarajaMock({ script: (msisdn) => {
    const i = Number(msisdn.slice(-8)) - 10000000; const { code, fault } = truth[i];
    return { code, lose: fault === 'lost', duplicate: fault === 'duplicate', delayMs: fault === 'late' ? 1500 : 0 };
  } });
  const app = await startApp({ pool, mode, darajaUrl: mock.url, creds: CREDS });

  const results = await Promise.all(truth.map((_, i) => app.checkout({ orderRef: `ORD${1000 + i}`, phone: phoneOf(i), amount: 100 + i })));

  // An attacker who has seen six checkout ids posts forged success callbacks for customers who cancelled.
  await sleep(50);
  const victims = results.filter((_, i) => truth[i].code === 1032).slice(0, 6);
  for (const [k, v] of victims.entries()) {
    const p = (await pool.query('SELECT amount FROM payments WHERE id=$1', [v.id])).rows[0];
    await fetch(app.callbackUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ Body: { stkCallback: {
      MerchantRequestID: 'x', CheckoutRequestID: v.checkoutRequestId, ResultCode: 0, ResultDesc: 'The service request is processed successfully.',
      CallbackMetadata: { Item: [{ Name: 'Amount', Value: p.amount }, { Name: 'MpesaReceiptNumber', Value: `FAKE00000${k}` }] } } } }) });
  }

  // Let callbacks arrive. The robust app also runs its reconciler, as a cron job would.
  for (let t = 0; t < 8; t++) { await sleep(400); if (mode === 'robust') await app.reconcile(800); }

  const { rows } = await pool.query(`SELECT p.id, p.order_ref, p.status, p.resolved_by, (SELECT count(*)::int FROM fulfilments f WHERE f.payment_id = p.id) AS fulfilled
    FROM payments p ORDER BY p.id`);
  const m = { unpaidFulfilled: 0, correctPaid: 0, wronglyPaid: 0, paidButNotRecorded: 0, failedCorrect: 0, stuckPending: 0, doubleFulfilled: 0, byQuery: 0 };
  rows.forEach((r) => {
    const i = Number(r.order_ref.slice(3)) - 1000;
    const paid = truth[i].code === 0;
    if (paid && r.status === 'paid') m.correctPaid++;
    if (!paid && r.status === 'paid') m.wronglyPaid++;
    if (paid && r.status !== 'paid') m.paidButNotRecorded++;
    if (!paid && r.status === 'failed') m.failedCorrect++;
    if (r.status === 'pending') m.stuckPending++;
    if (r.fulfilled > 1) m.doubleFulfilled++;
    if (!paid && r.fulfilled > 0) m.unpaidFulfilled++;
    if (r.resolved_by === 'query') m.byQuery++;
  });
  const cbs = (await pool.query('SELECT outcome, count(*)::int n FROM mpesa_callbacks GROUP BY 1 ORDER BY 1')).rows;
  app.close(); mock.server.close();
  return { m, stats: mock.stats, cbs };
}

console.log('200 STK Push checkouts: 140 pay, 20 cancel (1032), 16 time out (1037), 8 wrong PIN (2001), 8 insufficient funds (1), 8 expire (1019)');
const count = (f, paid) => truth.filter((t) => t.fault === f && (t.code === 0) === paid).length;
console.log(`Faults: ${count('lost', true)} success callbacks lost, ${count('duplicate', true)} duplicated, ${count('late', true)} delivered 1.5 s late, ${count('lost', false)} failure callbacks lost, 6 forged success callbacks\n`);
let robust;
for (const mode of ['naive', 'robust']) {
  const { m, stats, cbs } = await run(mode);
  if (mode === 'robust') robust = m;
  console.log(`${mode.toUpperCase()}`);
  console.log(`  paid and recorded as paid        ${m.correctPaid} of 140`);
  console.log(`  paid but not recorded as paid    ${m.paidButNotRecorded}`);
  console.log(`  not paid but recorded as paid    ${m.wronglyPaid}`);
  console.log(`  failures recorded as failed      ${m.failedCorrect} of 60`);
  console.log(`  still pending at the end         ${m.stuckPending}`);
  console.log(`  orders fulfilled more than once  ${m.doubleFulfilled}`);
  console.log(`  orders fulfilled without payment ${m.unpaidFulfilled}`);
  console.log(`  resolved by the STK query        ${m.byQuery}`);
  console.log(`  Daraja calls: ${stats.pushes} pushes, ${stats.callbacksSent} callbacks sent, ${stats.queries} queries`);
  if (cbs.length) console.log(`  callback log: ${cbs.map((c) => `${c.outcome} ${c.n}`).join(', ')}`);
  console.log('');
}
await pool.end();
// CI gate: the robust integration must get every payment right.
if (robust.correctPaid !== 140 || robust.failedCorrect !== 60 || robust.stuckPending || robust.doubleFulfilled || robust.unpaidFulfilled) {
  console.error('robust integration did not resolve every payment correctly'); process.exit(1);
}
