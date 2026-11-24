import fs from 'node:fs';
import pg from 'pg';
import { generate } from './generate.mjs';
import { naive, robust, score } from './engines.mjs';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost/recon' });
await pool.query(fs.readFileSync(new URL('./schema.sql', import.meta.url), 'utf8'));
const g = await generate(pool, { perDay: 2000 });
const counts = g.planted.reduce((m, [, t]) => ((m[t] = (m[t] ?? 0) + 1), m), {});
console.log(`3 days, ${g.internal} internal records, ${g.provider} provider report rows, 3 bank lines`);
console.log(`Planted problems: ${g.planted.length} (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
console.log('Also present and not problems: provider fees on every charge, refunds, and charges in the last 15 minutes of a day that the provider books after midnight.\n');

const out = {};
for (const [name, engine] of [['naive, net', (p) => naive(p, { column: 'net' })], ['naive, gross', (p) => naive(p, { column: 'gross' })], ['robust', robust]]) {
  const t0 = Date.now(); const b = await engine(pool); const ms = Date.now() - t0;
  const r = out[name] = score(b, g.planted);
  console.log(`${name.toUpperCase().padEnd(13)} breaks reported ${String(r.reported).padStart(5)} | real problems found ${r.tp}/${g.planted.length}`
    + ` (wrong type ${r.wrongType}) | false alarms ${String(r.fp).padStart(5)} | missed ${r.missed} | ${ms} ms`);
}

// Scale check: the robust engine on 3 days at 200,000 transactions a day.
if (!process.env.SKIP_SCALE) {
  const big = await generate(pool, { perDay: 200000 });
  await pool.query('ANALYZE');
  const t0 = Date.now(); const b = await robust(pool); const ms = Date.now() - t0;
  const r = score(b, big.planted);
  console.log(`\nSCALE robust engine, ${big.internal} internal and ${big.provider} provider rows: found ${r.tp}/${big.planted.length}, false alarms ${r.fp}, missed ${r.missed}, ${ms} ms`);
}
await pool.end();
if (out.robust.fp || out.robust.missed || out.robust.wrongType) { console.error('robust engine is wrong'); process.exit(1); }
