import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalInputQueue } from '../.test-dist/terminalInputQueue.js';
const up = '\x1b[<64;20;10M', down = '\x1b[<65;20;10M';

test('serializes delayed writes and batches wheel bursts without merging direction or ordinary input', async () => {
  const calls = []; let active = 0, peak = 0;
  const queue = new TerminalInputQueue(async (session, data) => {
    peak = Math.max(peak, ++active); calls.push([session, data]);
    await new Promise(resolve => setTimeout(resolve, 5)); --active;
  });
  await Promise.all([up,up,up].map(data => queue.write('a',data)));
  await Promise.all([down,'x','\r'].map(data => queue.write('a',data)));
  assert.equal(peak, 1);
  assert.deepEqual(calls.map(c=>c[1]), [up.repeat(3),down,'x','\r']);
});

test('a slow server keeps at most three pending wheel steps and reversal replaces stale direction', async () => {
  let release; const blocked=new Promise(resolve=>{release=resolve;}); const calls=[];
  const queue=new TerminalInputQueue(async(_,data)=>{calls.push(data);if(calls.length===1)await blocked;});
  const writes=[queue.write('a',up)]; await Promise.resolve();
  for(let i=0;i<100;i++)writes.push(queue.write('a',up));
  writes.push(queue.write('a',down));release();await Promise.all(writes);
  assert.deepEqual(calls,[up,down]);
});

test('failed paste rejects its queued submit without retry; next explicit input can proceed', async () => {
  const calls=[]; let fail=true;
  const queue = new TerminalInputQueue(async (_, data) => {calls.push(data); if(fail)throw Error('offline');});
  const result=await Promise.allSettled([queue.write('a','\x1b[200~hello\x1b[201~'), queue.write('a','\r')]);
  assert.ok(result.every(r=>r.status==='rejected')); assert.equal(calls.length,1);
  fail=false; await queue.write('a','retry'); assert.equal(calls.at(-1),'retry');
});

test('paste and Enter keep a delivery gap even when both waited behind network latency', async () => {
  const calls=[];
  const queue = new TerminalInputQueue(async (_,data)=>{calls.push({data,time:Date.now()});});
  await Promise.all([queue.write('a','\x1b[200~hello\x1b[201~'),queue.write('a','\r')]);
  assert.equal(calls.length,2); assert.ok(calls[1].time-calls[0].time>=170);
});

test('independent sessions do not block one another', async () => {
  let release; const blocked=new Promise(resolve=>{release=resolve;}); const calls=[];
  const queue=new TerminalInputQueue(async(session)=>{if(session==='a')await blocked; calls.push(session);});
  const first=queue.write('a','x'); await queue.write('b','y');
  assert.deepEqual(calls,['b']); release(); await first; assert.deepEqual(calls,['b','a']);
});
