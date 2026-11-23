# 04 Tool-calling AI agents in production

Article: https://codemwangi.substack.com/p/tool-calling-ai-agents-in-production

| File | Purpose |
|---|---|
| `agent.mjs` | Tool definitions, schema validation, idempotent refund tool, the agent loop with a step budget and tracing |
| `sim-model.mjs` | Simulated tool-calling model with seeded failure modes |
| `eval.mjs` | 10 refund tasks judged on final state, reported as pass^k across four guardrail configurations |
| `anthropic-adapter.mjs` | Plugs a real Claude model into the harness |

The simulated model exists so the guardrails and metrics can be tested deterministically. Its numbers describe the guardrails, not the quality of any real model.

```bash
npm test          # 8 trials per task
npm run test:32   # 32 trials per task, as in the article
```

To evaluate a real model, install dependencies, set `ANTHROPIC_API_KEY` and `MODEL`, and swap `simulatedModel(seed)` for `anthropicModel({ system })` in `eval.mjs`.
