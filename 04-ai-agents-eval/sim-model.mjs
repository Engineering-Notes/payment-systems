// A simulated tool-calling model with configurable, seeded failure modes.
// It does NOT stand in for any real model's quality. It exists so the harness,
// guardrails and metrics can be tested deterministically.

function rng(seed) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const FAILURE_RATES = {
  skip_lookup: 0.04,        // refunds without checking the payment first
  wrong_id: 0.02,           // copies the payment id wrongly
  amount_as_string: 0.05,   // sends "KES 2,500.00" for an integer field
  amount_major_units: 0.03, // sends 2500 meaning KES 2,500 (should be 250000)
  double_refund: 0.04,      // repeats a successful refund, as if it timed out
  start_loop: 0.03,         // gets stuck re-checking the payment
  ignore_error: 0.30,       // after an error, claims success and stops
};

const est = (s) => Math.ceil(s.length / 4);

export function simulatedModel(seed) {
  const r = rng(seed);
  let id = 0;
  const call = (name, input) => ({ type: 'tool_use', id: `toolu_${++id}`, name, input });
  const say = (text) => ({ type: 'text', text });

  return {
    async next(messages, task) {
      const input_tokens = 700 + messages.reduce((n, m) => n + est(JSON.stringify(m.content)), 0);
      const reply = (content, stop_reason) => ({ content, stop_reason,
        usage: { input_tokens, output_tokens: 40 + Math.floor(r() * 40) } });

      const last = messages[messages.length - 1];
      const results = Array.isArray(last.content) ? last.content : [];
      const lastErr = results.find((b) => b.is_error);
      const lookups = messages.filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content).filter((b) => b.name === 'payments_lookup').length;
      const refunds = messages.filter((m) => m.role === 'assistant')
        .flatMap((m) => m.content).filter((b) => b.name === 'payments_refund');

      // Stuck in a loop: keep re-checking the payment.
      if (this.looping) return reply([call('payments_lookup', { payment_id: task.paymentId })], 'tool_use');

      // First turn: look up the payment (or skip straight to a refund).
      if (messages.length === 1) {
        if (r() < FAILURE_RATES.skip_lookup && task.amount)
          return reply([call('payments_refund', { payment_id: task.paymentId, amount: task.amount })], 'tool_use');
        const pid = r() < FAILURE_RATES.wrong_id ? task.paymentId.replace(/\d$/, (d) => (+d + 1) % 10) : task.paymentId;
        return reply([call('payments_lookup', { payment_id: pid })], 'tool_use');
      }

      if (lastErr) {
        if (r() < FAILURE_RATES.ignore_error) return reply([say('Done, the refund has been processed.')], 'end_turn');
        if (/not found/.test(lastErr.content)) {
          if (lookups < 2) return reply([call('payments_lookup', { payment_id: task.paymentId })], 'tool_use');
          return reply([say(`I could not find payment ${task.paymentId}.`)], 'end_turn');
        }
        if (/invalid input/.test(lastErr.content))    // the error names the problem, so fix it
          return reply([call('payments_refund', { payment_id: task.paymentId, amount: task.amount ?? this.full })], 'tool_use');
        if (/exceeds refundable/.test(lastErr.content))
          return reply([say('That amount is more than can still be refunded on this payment.')], 'end_turn');
        return reply([say('Something went wrong; please contact support.')], 'end_turn');
      }

      const data = results[0] ? JSON.parse(results[0].content) : {};

      if (data.refund_id) {
        if (refunds.length === 1 && r() < FAILURE_RATES.double_refund)
          return reply([call('payments_refund', refunds[0].input)], 'tool_use');
        return reply([say(`Refunded ${data.amount ?? ''} on ${task.paymentId}.`)], 'end_turn');
      }

      if (data.status !== undefined) {           // a lookup result
        if (r() < FAILURE_RATES.start_loop) { this.looping = true;
          return reply([call('payments_lookup', { payment_id: task.paymentId })], 'tool_use'); }
        const remaining = data.amount - data.refunded;
        this.full = remaining;
        const want = task.amount ?? remaining;
        if (remaining === 0) return reply([say('This payment has already been fully refunded.')], 'end_turn');
        if (want > remaining) return reply([say('That amount is more than can still be refunded on this payment.')], 'end_turn');
        let amount = want;
        const x = r();
        if (x < FAILURE_RATES.amount_as_string) amount = `KES ${(want / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
        else if (x < FAILURE_RATES.amount_as_string + FAILURE_RATES.amount_major_units) amount = Math.round(want / 100);
        return reply([call('payments_refund', { payment_id: task.paymentId, amount })], 'tool_use');
      }

      return reply([say('Done.')], 'end_turn');
    },
  };
}
