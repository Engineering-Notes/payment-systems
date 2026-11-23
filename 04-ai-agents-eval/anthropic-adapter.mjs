// Adapter that plugs a real Claude model into the harness in place of the simulated model.
// Needs ANTHROPIC_API_KEY and MODEL (a model id of your choice) in the environment.
// Usage: in eval.mjs, replace simulatedModel(seed) with anthropicModel({ system: '...' }).
import Anthropic from '@anthropic-ai/sdk';
import { TOOLS } from './agent.mjs';

export function anthropicModel({ model = process.env.MODEL, system }) {
  if (!model) throw new Error('Set MODEL to the Claude model id you want to evaluate');
  const client = new Anthropic();   // reads ANTHROPIC_API_KEY
  return {
    async next(messages) {
      const res = await client.messages.create({
        model, system, tools: TOOLS, max_tokens: 1024, messages,
      });
      return { stop_reason: res.stop_reason, content: res.content, usage: res.usage };
    },
  };
}
