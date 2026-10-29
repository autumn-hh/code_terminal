import { terminalPerformance } from './terminalPerformance.js';
export interface InputReceipt { sent: Promise<void>; completed: Promise<void> }
interface InputSocket { readyState: number; bufferedAmount: number; send(data: string): void; close(): void }
type Entry = { id: number; sessionId: string; data: string; bytes: number;
  sent: () => void; done: () => void; fail: (error: Error) => void; started?: number; timer?: ReturnType<typeof setTimeout> };

// A small sliding window allows continuous wheel input without one RTT per
// batch. ACKs bound outstanding work; a failed connection never replays input.
export class TerminalSocketInput {
  private nextId = 0;
  private pending = new Map<number, Entry>();
  private waiting: Entry[] = [];
  private failure: Error | null = null;
  private pendingBytes = 0;

  constructor(private socket: InputSocket, private timeoutMs = 5000) {}

  write(sessionId: string, data: string): InputReceipt {
    let sent!: () => void, done!: () => void, rejectSent!: (e: Error) => void, rejectDone!: (e: Error) => void;
    const receipt = { sent: new Promise<void>((resolve, reject) => { sent = resolve; rejectSent = reject; }),
      completed: new Promise<void>((resolve, reject) => { done = resolve; rejectDone = reject; }) };
    void receipt.sent.catch(() => undefined);
    void receipt.completed.catch(() => undefined);
    const bytes = new TextEncoder().encode(data).length;
    const entry: Entry = { id: ++this.nextId, sessionId, data, bytes, sent, done,
      fail: error => { rejectSent(error); rejectDone(error); } };
    if (this.failure) entry.fail(this.failure);
    else if (bytes > 64 * 1024 || !bytes) entry.fail(new Error('终端单次输入需在 64KB 以内'));
    else if (this.waiting.length >= 64) entry.fail(new Error('终端输入队列已满，请稍后重试'));
    else {
      this.waiting.push(entry);
      entry.timer = setTimeout(() => this.fail(new Error('终端输入确认超时，请检查连接；输入未自动重发')), this.timeoutMs);
      this.flush();
    }
    return receipt;
  }

  acknowledge(id: number, error?: string | null) {
    const entry = this.pending.get(id);
    if (!entry) return;
    if (error) { this.fail(new Error(error)); return; }
    clearTimeout(entry.timer);
    if (entry.started) terminalPerformance.sample('socketAckMs', terminalPerformance.now() - entry.started);
    this.pending.delete(id); this.pendingBytes -= entry.bytes;
    entry.done(); this.flush();
  }

  fail(error = new Error('终端连接已断开；输入未自动重发')) {
    if (this.failure) return;
    this.failure = error;
    terminalPerformance.count('socketFailures');
    for (const entry of [...this.pending.values(), ...this.waiting]) { clearTimeout(entry.timer); entry.fail(error); }
    this.pending.clear(); this.waiting = []; this.pendingBytes = 0;
    this.socket.close();
  }

  private flush() {
    while (this.waiting.length && !this.failure) {
      if (this.socket.readyState !== 1) { this.fail(); return; }
      const entry = this.waiting[0];
      if (this.pending.size >= 8 || this.pendingBytes + entry.bytes > 64 * 1024) { terminalPerformance.count('socketBackpressure'); return; }
      if (this.socket.bufferedAmount > 512 * 1024) { this.fail(new Error('终端网络积压，请检查连接')); return; }
      this.waiting.shift(); this.pending.set(entry.id, entry); this.pendingBytes += entry.bytes;
      try { entry.started = terminalPerformance.now(); this.socket.send(JSON.stringify({id: entry.id, sessionId: entry.sessionId, data: entry.data})); terminalPerformance.count('socketWrites'); entry.sent(); }
      catch { this.fail(); }
    }
  }
}
