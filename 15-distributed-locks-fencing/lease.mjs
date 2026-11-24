// Acquire a lease if it is free or expired. Returns the fencing token, or null if someone else holds it.
export async function acquire(pool, name, holder, ttlMs) {
  const { rows } = await pool.query(`
    INSERT INTO leases (name, holder, token, expires_at)
    VALUES ($1, $2, nextval('fencing_tokens'), clock_timestamp() + $3 * interval '1 millisecond')
    ON CONFLICT (name) DO UPDATE
      SET holder = EXCLUDED.holder, token = EXCLUDED.token, expires_at = EXCLUDED.expires_at
      WHERE leases.expires_at < clock_timestamp()
    RETURNING token`, [name, holder, ttlMs]);
  return rows[0]?.token ?? null;
}

export async function release(pool, name, holder, token) {
  await pool.query('DELETE FROM leases WHERE name = $1 AND holder = $2 AND token = $3', [name, holder, token]);
}

// Was this holder's lease still valid at this moment? Used only to label writes for the experiment.
export async function stillValid(pool, name, token) {
  const { rows } = await pool.query('SELECT 1 FROM leases WHERE name = $1 AND token = $2 AND expires_at > clock_timestamp()', [name, token]);
  return rows.length === 1;
}
