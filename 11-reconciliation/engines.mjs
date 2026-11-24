// Two reconciliation engines over the same data. Each returns a list of breaks: [provider_ref or payout_id, type].
const days = ['2026-12-14', '2026-12-15', '2026-12-16'];

// NAIVE: per calendar day, match by reference, compare our amount with what the provider paid out (net).
export async function naive(pool, { column = 'net' } = {}) {
  const breaks = [];
  for (const d of days) {
    const { rows } = await pool.query(`
      WITH i AS (SELECT provider_ref, amount FROM internal_txns
                 WHERE created_at >= $1::date AND created_at < $1::date + 1),
           p AS (SELECT provider_ref, abs(${column}) AS net FROM provider_rows
                 WHERE created_at >= $1::date AND created_at < $1::date + 1)
      SELECT coalesce(i.provider_ref, p.provider_ref) AS ref, i.amount, p.net
      FROM i FULL OUTER JOIN p USING (provider_ref)
      WHERE i.provider_ref IS NULL OR p.provider_ref IS NULL OR i.amount <> p.net`, [d]);
    for (const r of rows) breaks.push([r.ref, r.amount == null ? 'missing_internally' : r.net == null ? 'missing_at_provider' : 'amount_mismatch']);
  }
  return breaks;
}

// ROBUST: compare like with like (gross), aggregate duplicates, allow for the provider's cut-off,
// and reconcile payouts against the bank as a separate, second level.
export async function robust(pool, { cutoffGraceMinutes = 60 } = {}) {
  const breaks = [];
  for (const d of days) {
    const { rows } = await pool.query(`
      WITH i AS (                                   -- our side for day d, one row per reference
        SELECT provider_ref, sum(amount) AS amount, count(*) AS n
        FROM internal_txns WHERE created_at >= $1::date AND created_at < $1::date + 1
        GROUP BY provider_ref),
      p AS (                                        -- provider side: day d, plus the grace window after midnight
        SELECT provider_ref, sum(abs(gross)) AS gross, count(*) AS n, min(created_at) AS first_seen
        FROM provider_rows
        WHERE created_at >= $1::date AND created_at < $1::date + 1 + make_interval(mins => $2)
        GROUP BY provider_ref),
      earlier AS (                                  -- items we recorded the day before that the provider booked today
        SELECT DISTINCT provider_ref FROM internal_txns
        WHERE created_at >= $1::date - 1 AND created_at < $1::date)
      SELECT coalesce(i.provider_ref, p.provider_ref) AS ref, i.amount, i.n AS in_n, p.gross, p.first_seen
      FROM i FULL OUTER JOIN p USING (provider_ref)
      WHERE NOT (i.provider_ref IS NULL AND p.provider_ref IN (SELECT provider_ref FROM earlier))
        AND (i.provider_ref IS NULL OR p.provider_ref IS NULL OR i.amount <> p.gross OR i.n > p.n)`, [d, cutoffGraceMinutes]);
    for (const r of rows) {
      if (r.amount == null) {
        if (r.first_seen >= new Date(Date.parse(d) + 86400000)) continue;   // grace-window row for tomorrow's ledger
        breaks.push([r.ref, 'missing_internally']);
      } else if (r.gross == null) breaks.push([r.ref, 'missing_at_provider']);
      else if (r.in_n > 1 && Number(r.amount) === Number(r.gross) * Number(r.in_n)) breaks.push([r.ref, 'duplicate_internal']);
      else breaks.push([r.ref, 'amount_mismatch']);
    }
  }
  // Second level: every payout in the provider report must arrive in the bank for the same amount.
  const { rows: payouts } = await pool.query(`
    SELECT p.payout_id, p.expected, b.amount AS received
    FROM (SELECT payout_id, sum(net) AS expected FROM provider_rows GROUP BY payout_id) p
    LEFT JOIN bank_lines b ON b.reference = p.payout_id
    WHERE b.amount IS DISTINCT FROM p.expected AND p.payout_id <= 'po_20261216'`);
  for (const r of payouts) breaks.push([r.payout_id, r.received == null ? 'payout_missing' : 'payout_short']);
  return breaks;
}

export function score(breaks, planted) {
  const truth = new Map(planted), seen = new Set();
  let tp = 0, wrongType = 0, fp = 0;
  for (const [ref, type] of breaks) {
    if (seen.has(ref)) continue; seen.add(ref);
    if (!truth.has(ref)) fp++; else if (truth.get(ref) === type) tp++; else wrongType++;
  }
  const missed = planted.filter(([ref]) => !seen.has(ref)).length;
  return { reported: seen.size, tp, wrongType, fp, missed };
}
