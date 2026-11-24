// 300 payments produce 680 webhook events. A sender delivers them, with retries, to a naive and a robust receiver.
// Afterwards an attacker sends forged, tampered and replayed requests.
import fs from 'node:fs';
import pg from 'pg';
import { newSecret, sign } from './signing.mjs';
import { deliver } from './sender.mjs';
import { startReceiver } from './receiver.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/webhooks', max: 30 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let seed = 42; const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };

// Build the event stream. Every event carries the full payment object and a version number.
const events = []; const truth = new Map();
for (let i = 0; i < 300; i++) {
  const id = `pay_${String(i).padStart(4, '0')}`, amount = 100 + i;
  const steps = ['pending', 'succeeded', ...(i % 5 === 0 ? ['refunded'] : [])];
  steps.forEach((status, v) => events.push({ id: `evt_${i}_${v}`, type: `payment.${status === 'pending' ? 'created' : status}`,
    data: { id, amount, status, version: v + 1 } }));
  truth.set(id, steps.at(-1));
}
const expectedBalance = [...truth].reduce((s, [id, st]) => s + (st === 'succeeded' ? 100 + Number(id.slice(4)) : 0), 0);

async function run(mode) {
  await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
  const secret = newSecret();
  seed = 42;
  const rcv = await startReceiver({ pool, mode, secrets: [secret], toleranceSec: 2,
    flaky: () => rand() < 0.05, slowWork: () => (rand() < 0.15 ? 400 : 20) });   // 15% of events need slow work
  const stats = { attempts: 0, delivered: 0, non2xx: 0, timeouts: 0, gaveUp: 0 };
  let stop = false;
  const workers = mode === 'robust' ? Array.from({ length: 4 }, async () => { while (!stop) { if (!(await rcv.work())) await sleep(20); } }) : [];

  // Events for the same payment are sent close together and can overtake each other, as they do in production.
  const captured = [];
  await Promise.all(events.map(async (event, k) => {
    await sleep(Math.floor(k / 3) * 4 + rand() * 30);
    await deliver({ url: rcv.url, secret, event, stats });
    if (event.type === 'payment.refunded' && captured.length < 10) {
      const body = JSON.stringify(event), ts = String(Math.floor(Date.now() / 1000));
      captured.push({ body, headers: { 'content-type': 'application/json', 'webhook-id': event.id, 'webhook-timestamp': ts, 'webhook-signature': sign(secret, event.id, ts, body) } });
    }
  }));

  // Attacks.
  const attack = { forged: 0, tampered: 0, replayed: 0 };
  const post = (headers, body) => fetch(rcv.url, { method: 'POST', headers, body }).then((r) => r.status);
  for (let k = 0; k < 10; k++) {                                   // forged: attacker has no secret
    const e = { id: `evt_fake_${k}`, type: 'payment.succeeded', data: { id: `pay_fake_${k}`, amount: 50000, status: 'succeeded', version: 9 } };
    const body = JSON.stringify(e), ts = String(Math.floor(Date.now() / 1000));
    if ((await post({ 'content-type': 'application/json', 'webhook-id': e.id, 'webhook-timestamp': ts, 'webhook-signature': sign(newSecret(), e.id, ts, body) }, body)) === 200) attack.forged++;
  }
  for (const c of captured) {                                       // tampered: real headers, amount changed
    const e = JSON.parse(c.body); e.type = 'payment.succeeded'; e.data.status = 'succeeded'; e.data.amount = 99999; e.data.version = 9;
    if ((await post(c.headers, JSON.stringify(e))) === 200) attack.tampered++;
  }
  await sleep(2500);                                                // past the 2 s tolerance used in this test
  for (const c of captured) if ((await post(c.headers, c.body)) === 200) attack.replayed++;   // replayed: exact bytes

  await sleep(1500); stop = true; await Promise.all(workers);
  while (mode === 'robust' && (await rcv.work(100))) {}             // drain
  rcv.close();

  const { rows } = await pool.query('SELECT id, status FROM payments');
  const wrongStatus = rows.filter((r) => truth.has(r.id) && truth.get(r.id) !== r.status).length;
  const fakePayments = rows.filter((r) => !truth.has(r.id)).length;
  const { rows: [b] } = await pool.query(`SELECT coalesce(sum(CASE kind WHEN 'credit' THEN amount ELSE -amount END), 0)::int AS bal FROM ledger_entries`);
  const { rows: [d] } = await pool.query(`SELECT count(*)::int AS n FROM (SELECT payment_id, kind FROM ledger_entries GROUP BY 1, 2 HAVING count(*) > 1) x`);
  return { stats, attack, wrongStatus, fakePayments, balance: b.bal, dupEffects: d.n, rejected: rcv.counters.rejected };
}

console.log(`${events.length} events for 300 payments (60 refunded). Sender: 300 ms timeout, 6 attempts with backoff. Receiver: 5% random 503s, 15% of events need 400 ms of work.`);
console.log(`Expected merchant balance: ${expectedBalance}\n`);
const out = {};
for (const mode of ['naive', 'robust']) {
  const r = out[mode] = await run(mode);
  console.log(mode.toUpperCase());
  console.log(`  sender: ${r.stats.attempts} attempts for ${events.length} events | ${r.stats.timeouts} timeouts | ${r.stats.non2xx} non-2xx | gave up ${r.stats.gaveUp}`);
  console.log(`  payments with the wrong final status   ${r.wrongStatus} of 300`);
  console.log(`  ledger effects applied more than once  ${r.dupEffects}`);
  console.log(`  merchant balance                       ${r.balance} (expected ${expectedBalance}, off by ${r.balance - expectedBalance})`);
  console.log(`  attacks accepted: forged ${r.attack.forged}/10, tampered ${r.attack.tampered}/10, replayed ${r.attack.replayed}/10 | fake payments created ${r.fakePayments}`);
  console.log(`  rejected by receiver: ${JSON.stringify(r.rejected)}\n`);
}
await pool.end();
const R = out.robust;
if (R.wrongStatus || R.dupEffects || R.balance !== expectedBalance || R.attack.forged || R.attack.tampered || R.fakePayments) {
  console.error('robust receiver produced a wrong result'); process.exit(1);
}
