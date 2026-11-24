// Generates three days of data with known, labelled problems.
// Returns the list of problems that were planted, so the engines can be scored.
let s = 20261217; const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
const DAY = 86400000, START = Date.parse('2026-12-14T00:00:00Z');

export async function generate(pool, { perDay = 2000 } = {}) {
  s = 20261217;
  const internal = [], provider = [], planted = [];
  let n = 0;
  for (let d = 0; d < 3; d++) {
    for (let i = 0; i < perDay; i++) {
      n++;
      const ref = `ch_${String(n).padStart(6, '0')}`;
      // 5% of charges happen in the last 15 minutes of the day; the provider books them the next day.
      const late = rnd() < 0.05;
      const t = START + d * DAY + (late ? DAY - rnd() * 15 * 60000 : rnd() * (DAY - 20 * 60000));
      const amount = 500 + Math.floor(rnd() * 20000);
      const fee = Math.round(amount * 0.029) + 30;
      const pt = late ? t + 20 * 60000 : t + rnd() * 60000;        // provider timestamp
      const roll = rnd();
      if (roll < 0.004) { internal.push([ref, 'charge', amount, t]); planted.push([ref, 'missing_at_provider']); continue; }
      if (roll < 0.008) { provider.push([ref, 'charge', amount, fee, pt]); planted.push([ref, 'missing_internally']); continue; }
      if (roll < 0.011) { internal.push([ref, 'charge', amount + 100, t]); provider.push([ref, 'charge', amount, fee, pt]); planted.push([ref, 'amount_mismatch']); continue; }
      if (roll < 0.013) { internal.push([ref, 'charge', amount, t], [ref, 'charge', amount, t + 1000]); provider.push([ref, 'charge', amount, fee, pt]); planted.push([ref, 'duplicate_internal']); continue; }
      internal.push([ref, 'charge', amount, t]); provider.push([ref, 'charge', amount, fee, pt]);
      if (rnd() < 0.02) {                                           // refunds: fee not returned
        const rref = `re_${ref.slice(3)}`, rt = t + 3600000;
        internal.push([rref, 'refund', amount, rt]); provider.push([rref, 'refund', -amount, 0, rt + 30000]);
      }
    }
  }
  await pool.query('TRUNCATE internal_txns, provider_rows, bank_lines, recon_results');
  for (let i = 0; i < internal.length; i += 1000) {
    const chunk = internal.slice(i, i + 1000);
    await pool.query(`INSERT INTO internal_txns (provider_ref, kind, amount, currency, created_at)
      SELECT r, k, a, 'USD', to_timestamp(t / 1000.0) FROM unnest($1::text[], $2::text[], $3::bigint[], $4::float8[]) AS x(r, k, a, t)`,
      [chunk.map((c) => c[0]), chunk.map((c) => c[1]), chunk.map((c) => c[2]), chunk.map((c) => c[3])]);
  }
  for (let i = 0; i < provider.length; i += 1000) {
    const chunk = provider.slice(i, i + 1000);
    await pool.query(`INSERT INTO provider_rows (provider_ref, kind, gross, fee, net, currency, created_at, payout_id)
      SELECT r, k, g, f, g - f, 'USD', to_timestamp(t / 1000.0), 'po_' || to_char(to_timestamp(t / 1000.0) AT TIME ZONE 'UTC', 'YYYYMMDD')
      FROM unnest($1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::float8[]) AS x(r, k, g, f, t)`,
      [chunk.map((c) => c[0]), chunk.map((c) => c[1]), chunk.map((c) => c[2]), chunk.map((c) => c[3]), chunk.map((c) => c[4])]);
  }
  // Bank: one payout per provider day, arriving two days later. The third day's payout is short by a 25.00 bank charge.
  await pool.query(`INSERT INTO bank_lines (reference, amount, value_date)
    SELECT payout_id, sum(net) - CASE WHEN payout_id = 'po_20261216' THEN 2500 ELSE 0 END,
           (min(created_at) AT TIME ZONE 'UTC')::date + 2
    FROM provider_rows WHERE created_at < '2026-12-17' GROUP BY payout_id`);
  planted.push(['po_20261216', 'payout_short']);
  return { internal: internal.length, provider: provider.length, planted };
}
