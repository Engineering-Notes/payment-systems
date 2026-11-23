// A provider-agnostic tool-calling loop with guardrails and tracing.
// Message shapes follow the Anthropic Messages API (tool_use / tool_result blocks).

export const TOOLS = [
  {
    name: 'payments_lookup',
    description: 'Look up one payment by its id (format P-123). Returns amount, currency, '
      + 'status and amount already refunded, in minor units. Use this before any refund. '
      + 'Returns an error if the payment does not exist.',
    input_schema: { type: 'object', properties: { payment_id: { type: 'string', pattern: '^P-\\d+$' } },
                    required: ['payment_id'], additionalProperties: false },
  },
  {
    name: 'payments_refund',
    description: 'Refund part or all of a captured payment. amount is an integer in minor units '
      + '(KES 25.00 is 2500) and must not exceed the remaining refundable amount. '
      + 'Never call this twice for the same request.',
    input_schema: { type: 'object', properties: {
        payment_id: { type: 'string', pattern: '^P-\\d+$' },
        amount: { type: 'integer', minimum: 1 } },
      required: ['payment_id', 'amount'], additionalProperties: false },
  },
];

// Minimal JSON Schema check covering what these tools use.
export function validate(schema, input) {
  if (typeof input !== 'object' || input === null) return 'input must be an object';
  for (const k of schema.required ?? []) if (!(k in input)) return `missing required parameter '${k}'`;
  for (const [k, v] of Object.entries(input)) {
    const p = schema.properties[k];
    if (!p) return `unknown parameter '${k}'`;
    if (p.type === 'integer' && !Number.isInteger(v)) return `'${k}' must be an integer in minor units, got ${JSON.stringify(v)}`;
    if (p.type === 'string' && typeof v !== 'string') return `'${k}' must be a string`;
    if (p.pattern && !new RegExp(p.pattern).test(v)) return `'${k}' must match ${p.pattern}, got ${JSON.stringify(v)}`;
    if (p.minimum !== undefined && v < p.minimum) return `'${k}' must be at least ${p.minimum}`;
  }
  return null;
}

// Tool implementations run against a world state the eval can inspect afterwards.
export function makeTools(world, { idempotentRefunds }) {
  return {
    payments_lookup({ payment_id }) {
      const p = world.payments[payment_id];
      if (!p) throw new Error(`payment ${payment_id} not found`);
      return { payment_id, amount: p.amount, currency: p.currency, status: p.status, refunded: p.refunded };
    },
    payments_refund({ payment_id, amount }, ctx) {
      const p = world.payments[payment_id];
      if (!p) throw new Error(`payment ${payment_id} not found`);
      if (idempotentRefunds) {
        const key = `${ctx.taskId}:${payment_id}:${amount}`;
        if (world.refundKeys.has(key)) return { replayed: true, refund_id: world.refundKeys.get(key) };
      }
      if (amount > p.amount - p.refunded)
        throw new Error(`amount ${amount} exceeds refundable balance ${p.amount - p.refunded}`);
      p.refunded += amount;
      const id = `R-${world.refunds.length + 1}`;
      world.refunds.push({ id, payment_id, amount });
      if (idempotentRefunds) world.refundKeys.set(`${ctx.taskId}:${payment_id}:${amount}`, id);
      return { refund_id: id, payment_id, amount };
    },
  };
}

// The loop. `model.next(messages)` returns { stop_reason, content, usage }.
export async function runAgent({ model, task, world, guards, trace }) {
  const tools = makeTools(world, { idempotentRefunds: guards.idempotentRefunds });
  const messages = [{ role: 'user', content: task.prompt }];
  let toolCalls = 0;

  for (let turn = 0; ; turn++) {
    const t0 = performance.now();
    const res = await model.next(messages, task);
    trace.push({ span: 'chat', turn, input_tokens: res.usage.input_tokens,
                 output_tokens: res.usage.output_tokens, ms: performance.now() - t0 });
    messages.push({ role: 'assistant', content: res.content });

    if (res.stop_reason !== 'tool_use') {
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
      return { outcome: 'final', text, toolCalls };
    }

    const results = [];
    for (const block of res.content.filter((b) => b.type === 'tool_use')) {
      toolCalls++;
      const span = { span: 'execute_tool', tool: block.name, call_id: block.id, input: block.input };
      if (guards.maxToolCalls && toolCalls > guards.maxToolCalls) {
        trace.push({ ...span, error: 'step budget exhausted' });
        return { outcome: 'budget_exhausted', toolCalls };
      }
      const def = TOOLS.find((t) => t.name === block.name);
      let result;
      try {
        if (!def) throw new Error(`unknown tool '${block.name}'`);
        if (guards.validateInputs) {
          const err = validate(def.input_schema, block.input);
          if (err) throw new Error(`invalid input: ${err}`);
        }
        const out = tools[block.name](block.input, { taskId: task.id });
        result = { type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) };
      } catch (e) {
        result = { type: 'tool_result', tool_use_id: block.id, content: `Error: ${e.message}`, is_error: true };
        span.error = e.message;
      }
      trace.push(span);
      results.push(result);
    }
    messages.push({ role: 'user', content: results });   // tool_result blocks first, nothing else
  }
}
