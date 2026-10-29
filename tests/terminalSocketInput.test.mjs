import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalSocketInput } from '../.test-dist/terminalSocketInput.js';
import { TerminalInputQueue } from '../.test-dist/terminalInputQueue.js';
const wheel='\x1b[<64;10;10M';
function fixture(timeout=5000){
  const frames=[];const socket={readyState:1,bufferedAmount:0,send(data){frames.push(JSON.parse(data));},close(){this.readyState=3;}};
  return {frames,socket,input:new TerminalSocketInput(socket,timeout)};
}
test('pipelines eight ordered frames without RTT gating, then waits for ACK credit',async()=>{
  const {frames,input}=fixture();const receipts=Array.from({length:9},(_,i)=>input.write('a',String(i)));
  await Promise.all(receipts.slice(0,8).map(r=>r.sent));assert.equal(frames.length,8);
  input.acknowledge(frames[0].id);await receipts[8].sent;assert.equal(frames.length,9);
  assert.deepEqual(frames.map(f=>f.data),Array.from({length:9},(_,i)=>String(i)));
  frames.forEach(f=>input.acknowledge(f.id));await Promise.all(receipts.map(r=>r.completed));
});
test('disconnect rejects sent and queued input without replay',async()=>{
  const {frames,input,socket}=fixture();const receipts=Array.from({length:10},()=>input.write('a','x'));
  input.fail();assert.equal(socket.readyState,3);assert.equal(frames.length,8);
  const results=await Promise.allSettled(receipts.map(r=>r.completed));assert.ok(results.every(r=>r.status==='rejected'));
  await assert.rejects(input.write('a','new').sent);assert.equal(frames.length,8);
});
test('ACK failure and timeout reject rather than silently losing input',async()=>{
  const first=fixture();const r=first.input.write('a','x');first.input.acknowledge(first.frames[0].id,'session closed');
  await assert.rejects(r.completed,/session closed/);
  const second=fixture(10);await assert.rejects(second.input.write('a','x').completed,/超时/);
});
test('limits UTF-8 bytes and pending byte budget',async()=>{
  const {input,frames}=fixture();await assert.rejects(input.write('a','中'.repeat(22000)).sent,/64KB/);
  const a=input.write('a','a'.repeat(40000)),b=input.write('b','b'.repeat(40000));
  assert.equal(frames.length,1);input.acknowledge(frames[0].id);await b.sent;assert.equal(frames.length,2);
  input.acknowledge(frames[1].id);await Promise.all([a.completed,b.completed]);
});
test('wheel queue pipelines while paste failure still blocks queued Enter',async()=>{
  const {input,frames}=fixture();const queue=new TerminalInputQueue(async(id,data)=>input.write(id,data));
  const writes=[];for(let i=0;i<3;i++){writes.push(queue.write('a',wheel));await new Promise(r=>setTimeout(r,0));}
  assert.equal(frames.length,3);frames.forEach(f=>input.acknowledge(f.id));await Promise.all(writes);
  const paste=queue.write('a','\x1b[200~text\x1b[201~'),enter=queue.write('a','\r');
  const pending=Promise.allSettled([paste,enter]);await new Promise(r=>setTimeout(r,0));
  assert.equal(frames.length,4);input.acknowledge(frames[3].id,'write failed');
  assert.ok((await pending).every(r=>r.status==='rejected'));assert.equal(frames.length,4);
});

test('ordinary typing does not wait an RTT per character',async()=>{
  const {input,frames}=fixture();const queue=new TerminalInputQueue(async(id,data)=>input.write(id,data));
  const writes=['a','b','c'].map(data=>queue.write('a',data));await new Promise(r=>setTimeout(r,0));
  assert.deepEqual(frames.map(f=>f.data),['a','b','c']);
  frames.forEach(f=>input.acknowledge(f.id));await Promise.all(writes);
});
