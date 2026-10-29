import test from 'node:test';
import assert from 'node:assert/strict';
import { terminalPerformance as perf } from '../.test-dist/terminalPerformance.js';
test('diagnostics are opt-in, bounded and expose only aggregate numeric data',()=>{
  perf.reset();perf.enable(false);perf.count('wheelInputs');perf.sample('socketAckMs',10);
  assert.deepEqual(perf.snapshot().timings,{});assert.deepEqual(perf.snapshot().counters,{});
  perf.enable();for(let i=0;i<1000;i++)perf.sample('socketAckMs',i);
  perf.wheel('private-session');perf.output('private-session');perf.rendered('private-session');
  const report=perf.snapshot();assert.equal(report.timings.socketAckMs.samples,240);
  assert.equal(report.timings.socketAckMs.max,999);assert.ok(!JSON.stringify(report).includes('private-session'));
  perf.reset();assert.deepEqual(perf.snapshot().counters,{});perf.enable(false);
});
