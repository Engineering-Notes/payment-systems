// Three ways to apply "read a balance, decide, write a new balance" safely under concurrency.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pessimistic: lock the row when reading it. Other writers wait.
export async function pessimistic(pool, id, delta, thinkMs) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows: [a] } = await c.query('SELECT balance FROM wallets WHERE id = $1 FOR UPDATE', [id]);
    await sleep(thinkMs);                                         // application logic between read and write
    if (a.balance + delta < 0) { await c.query('ROLLBACK'); return { ok: false, retries: 0 }; }
    await c.query('UPDATE wallets SET balance = $2, version = version + 1 WHERE id = $1', [id, a.balance + delta]);
    await c.query('COMMIT');
    return { ok: true, retries: 0 };
  } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
}

// Optimistic: read without locking, write only if the version is unchanged, retry otherwise.
export async function optimistic(pool, id, delta, thinkMs, maxRetries = 1000) {
  for (let retries = 0; retries <= maxRetries; retries++) {
    const { rows: [a] } = await pool.query('SELECT balance, version FROM wallets WHERE id = $1', [id]);
    await sleep(thinkMs);
    if (a.balance + delta < 0) return { ok: false, retries };
    const { rowCount } = await pool.query(
      'UPDATE wallets SET balance = $2, version = version + 1 WHERE id = $1 AND version = $3', [id, a.balance + delta, a.version]);
    if (rowCount === 1) return { ok: true, retries };
    await sleep(Math.random() * Math.min(50, 2 ** retries));     // someone else won: back off with jitter, then retry
  }
  throw new Error('gave up');
}

// Atomic: no read in the application. The rule lives in the WHERE clause.
export async function atomic(pool, id, delta, thinkMs) {
  await sleep(thinkMs);
  const { rowCount } = await pool.query(
    'UPDATE wallets SET balance = balance + $2, version = version + 1 WHERE id = $1 AND balance + $2 >= 0', [id, delta]);
  return { ok: rowCount === 1, retries: 0 };
}
