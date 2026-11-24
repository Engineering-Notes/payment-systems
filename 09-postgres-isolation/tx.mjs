// Run fn inside a transaction at the given isolation level.
// Retries serialization failures (SQLSTATE 40001) and deadlocks (40P01) up to maxRetries times.
export async function inTx(pool, level, fn, { maxRetries = 0, stats } = {}) {
  for (let attempt = 0; ; attempt++) {
    const c = await pool.connect();
    try {
      await c.query(`BEGIN ISOLATION LEVEL ${level}`);
      const out = await fn(c);
      await c.query('COMMIT');
      return out;
    } catch (e) {
      await c.query('ROLLBACK').catch(() => {});
      const retryable = e.code === '40001' || e.code === '40P01';
      if (stats && retryable) stats.serializationFailures++;
      if (retryable && attempt < maxRetries) { if (stats) stats.retries++; await new Promise((r) => setTimeout(r, Math.random() * 10 * (attempt + 1))); continue; }
      throw e;
    } finally { c.release(); }
  }
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
