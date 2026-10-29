type Metric = 'inputQueueMs' | 'socketAckMs' | 'httpWriteMs' | 'wheelToRenderMs' |
  'outputToRenderMs' | 'scrollSyncMs' | 'snapshotMs' | 'longTaskMs';
type Counter = 'socketWrites' | 'httpWrites' | 'wheelInputs' | 'renders' | 'coalescedWheels' |
  'socketBackpressure' | 'socketFailures' | 'outputChunks' | 'overlappingWheels';

// Opt-in, bounded, local numeric diagnostics. Never retain commands, output,
// credentials or URLs. Internal correlation keys are not included in reports.
class TerminalPerformance {
  private enabled = false;
  private samples = new Map<Metric, number[]>();
  private counters = new Map<Counter, number>();
  private pending = new Map<string, { wheel?: number; output?: number; lastWheel?: number }>();
  private observer: PerformanceObserver | null = null;
  enable(value = true) {
    this.enabled = value;
    this.observer?.disconnect(); this.observer = null; this.pending.clear();
    if (value && typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')) {
      this.observer = new PerformanceObserver(list => list.getEntries().forEach(entry => this.sample('longTaskMs', entry.duration)));
      this.observer.observe({ type: 'longtask' });
    }
  }
  now() { return this.enabled ? performance.now() : 0; }
  count(name: Counter) { if (this.enabled) this.counters.set(name, (this.counters.get(name) ?? 0) + 1); }
  sample(name: Metric, value: number) {
    if (!this.enabled || !Number.isFinite(value) || value < 0) return;
    const values = this.samples.get(name) ?? [];
    if (values.length === 240) values.shift();
    values.push(value); this.samples.set(name, values);
  }
  wheel(session: string) {
    if (!this.enabled) return;
    const pending = this.pending.get(session) ?? {}, now = performance.now();
    // Continuous wheel input cannot be correlated with one particular TUI
    // redraw. Only time isolated wheel events; never report a false near-zero
    // latency by pairing new input with output from the preceding event.
    if (pending.lastWheel === undefined || now - pending.lastWheel > 250) pending.wheel = now;
    else { pending.wheel = undefined; this.count('overlappingWheels'); }
    pending.lastWheel = now;
    this.pending.set(session, pending); this.count('wheelInputs');
  }
  output(session: string) {
    if (!this.enabled) return;
    const pending = this.pending.get(session) ?? {};
    pending.output ??= performance.now(); this.pending.set(session, pending); this.count('outputChunks');
  }
  rendered(session: string) {
    if (!this.enabled) return;
    const pending = this.pending.get(session), now = performance.now();
    if (pending?.output !== undefined) {
      this.sample('outputToRenderMs', now - pending.output);
      if (pending.wheel !== undefined && now - pending.wheel <= 2500) this.sample('wheelToRenderMs', now - pending.wheel);
      pending.wheel = undefined; pending.output = undefined;
    }
    this.count('renders');
  }
  forget(session: string) { this.pending.delete(session); }
  reset() { this.samples.clear(); this.counters.clear(); this.pending.clear(); }
  snapshot() {
    return { enabled: this.enabled, sampleLimit: 240, counters: Object.fromEntries(this.counters),
      timings: Object.fromEntries([...this.samples].map(([name, values]) => {
        const sorted = [...values].sort((a, b) => a - b), round = (n: number) => Math.round(n * 10) / 10;
        return [name, { samples: values.length, p50: round(sorted[Math.floor(sorted.length * .5)]),
          p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))]), max: round(sorted[sorted.length - 1]) }];
      })) };
  }
}
export const terminalPerformance = new TerminalPerformance();
if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'codeTerminalPerf', { value: Object.freeze({
    enable: (value = true) => terminalPerformance.enable(value),
    reset: () => terminalPerformance.reset(), snapshot: () => terminalPerformance.snapshot(),
  }), configurable: true });
}
