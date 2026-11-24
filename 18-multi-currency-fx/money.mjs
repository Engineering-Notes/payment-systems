// Money as integer minor units, with the exponent per currency (ISO 4217).
export const EXPONENT = { KES: 2, USD: 2, EUR: 2, JPY: 0, UGX: 0, BHD: 3, KWD: 3 };

export function toMinor(decimalString, currency) {
  const e = EXPONENT[currency]; if (e === undefined) throw new Error(`unknown currency ${currency}`);
  const [whole, frac = ''] = String(decimalString).split('.');
  if (frac.length > e) throw new Error(`${currency} has ${e} decimal places, got ${decimalString}`);
  return BigInt(whole + frac.padEnd(e, '0'));
}
export function format(minor, currency) {
  const e = EXPONENT[currency], s = (minor < 0n ? -minor : minor).toString().padStart(e + 1, '0');
  return `${minor < 0n ? '-' : ''}${e ? s.slice(0, -e) + '.' + s.slice(-e) : s} ${currency}`;
}

// Convert using a rate given as a decimal string, rounding half to even (banker's rounding) or half up.
export function convert(minor, from, to, rate, mode = 'half-even') {
  const [w, f = ''] = rate.split('.'); const rateScaled = BigInt(w + f), rateScale = 10n ** BigInt(f.length);
  const num = minor * rateScaled * 10n ** BigInt(EXPONENT[to]);
  const den = rateScale * 10n ** BigInt(EXPONENT[from]);
  return divRound(num, den, mode);
}
export function divRound(num, den, mode) {
  const q = num / den, r = num % den, twice = 2n * (r < 0n ? -r : r);
  if (twice < den) return q;
  if (twice > den || mode === 'half-up') return q + (num < 0n ? -1n : 1n);
  return q % 2n === 0n ? q : q + (num < 0n ? -1n : 1n);     // exactly half: round to even
}

// Split an amount into parts by weights so the parts always add back to the total (largest remainder).
export function allocate(minor, weights) {
  const total = weights.reduce((a, b) => a + b, 0n);
  const parts = weights.map((w) => (minor * w) / total);
  let left = minor - parts.reduce((a, b) => a + b, 0n);
  const order = weights.map((w, i) => [(minor * w) % total, i]).sort((a, b) => (b[0] > a[0] ? 1 : b[0] < a[0] ? -1 : 0));
  for (let k = 0; left > 0n; k++, left--) parts[order[k % order.length][1]] += 1n;
  return parts;
}
