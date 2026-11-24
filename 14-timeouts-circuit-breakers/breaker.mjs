// A small circuit breaker: closed -> open when the recent failure rate is too high,
// open -> half-open after a cool-down, half-open -> closed after a successful probe.
export class CircuitBreaker {
  constructor({ windowSize = 20, failureRate = 0.5, minCalls = 10, openMs = 1000, now = () => Date.now() } = {}) {
    Object.assign(this, { windowSize, failureRate, minCalls, openMs, now });
    this.state = 'closed'; this.results = []; this.openedAt = 0; this.probing = false;
    this.transitions = [];
  }
  #to(state) { this.state = state; this.transitions.push([this.now(), state]); }
  allow() {
    if (this.state === 'open' && this.now() - this.openedAt >= this.openMs) this.#to('half-open');
    if (this.state === 'open') return false;
    if (this.state === 'half-open') { if (this.probing) return false; this.probing = true; }
    return true;
  }
  record(ok) {
    if (this.state === 'half-open') {
      this.probing = false;
      if (ok) { this.results = []; this.#to('closed'); } else { this.openedAt = this.now(); this.#to('open'); }
      return;
    }
    this.results.push(ok); if (this.results.length > this.windowSize) this.results.shift();
    const fails = this.results.filter((r) => !r).length;
    if (this.results.length >= this.minCalls && fails / this.results.length >= this.failureRate) { this.openedAt = this.now(); this.#to('open'); }
  }
  async call(fn, fallback) {
    if (!this.allow()) return fallback(new Error('circuit open'));
    try { const v = await fn(); this.record(true); return v; }
    catch (e) { this.record(false); return fallback(e); }
  }
}
