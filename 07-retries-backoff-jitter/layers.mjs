// Scenario 3: retries at every layer multiply. Each layer makes up to 3 attempts.
// The bottom dependency always fails, so every layer exhausts its attempts.
function withRetries(fn, attempts) {
  return () => { for (let i = 0; i < attempts; i++) { try { return fn(); } catch { /* retry */ } } throw new Error('failed'); };
}

export function callsToDatabase(layers, attempts = 3, retryOnlyAtTop = false) {
  let dbCalls = 0;
  let fn = () => { dbCalls++; throw new Error('database unavailable'); };
  for (let i = 0; i < layers; i++) {
    const isTop = i === layers - 1;
    fn = withRetries(fn, retryOnlyAtTop && !isTop ? 1 : attempts);
  }
  try { fn(); } catch { /* expected */ }
  return dbCalls;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('3 LAYERED RETRIES: database always failing, 3 attempts per layer, one user request');
  for (const n of [1, 2, 3, 4, 5]) {
    console.log(`  ${n} layer${n > 1 ? 's' : ' '}  every layer retries: ${String(callsToDatabase(n)).padStart(3)} database calls | only the top layer retries: ${callsToDatabase(n, 3, true)}`);
  }
}
