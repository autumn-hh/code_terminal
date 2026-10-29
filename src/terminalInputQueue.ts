import type { InputReceipt } from './terminalSocketInput';
import { terminalPerformance } from './terminalPerformance.js';
type PendingWrite = { data: string; wheel: string | null; queued: number; resolve: () => void; reject: (error: unknown) => void };

function wheelKey(data: string) {
  const events = data.match(/\x1b\[<6[45];\d+;\d+M/g);
  return events?.join('') === data && events.every(event => event === events[0]) ? events[0] : null;
}

// HTTP remains serial. Ordered sockets pipeline input within a bounded ACK
// window. Bracketed paste is a barrier: its submit must wait for confirmation.
export class TerminalInputQueue {
  private sessions = new Map<string, PendingWrite[]>();

  constructor(private send: (sessionId: string, data: string) => Promise<void | InputReceipt>) {}

  write(sessionId: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = this.sessions.get(sessionId);
      const write = { data, wheel: wheelKey(data), queued: terminalPerformance.now(), resolve, reject };
      if (pending) {
        // Keep only a short pending wheel burst. Reversal supersedes stale
        // wheel intent, and a long drag must not keep scrolling after release.
        // Never cross a typed-input boundary or cancel an in-flight request.
        if (write.wheel) {
          while (pending[pending.length - 1]?.wheel && (pending[pending.length - 1]!.wheel !== write.wheel ||
            pending.slice(-3).filter(item => item.wheel === write.wheel).length >= 3)) {
            pending.pop()!.resolve();
            terminalPerformance.count('coalescedWheels');
          }
        }
        pending.push(write);
      } else {
        const queue = [write];
        this.sessions.set(sessionId, queue);
        // Collect a synchronous burst (e.g. grip steps) before opening HTTP.
        queueMicrotask(() => void this.drain(sessionId, queue));
      }
    });
  }

  private async drain(sessionId: string, queue: PendingWrite[]) {
    let failure: unknown;
    const fail = (error: unknown) => { failure = error; queue.splice(0).forEach(item => item.reject(error)); };
    while (queue.length) {
      const batch = [queue.shift()!];
      while (batch[0].wheel && queue[0]?.wheel === batch[0].wheel && batch.length < 3) batch.push(queue.shift()!);
      const data = batch.map(item => item.data).join('');
      try {
        if (failure) throw failure;
        if (batch[0].queued) terminalPerformance.sample('inputQueueMs', terminalPerformance.now() - batch[0].queued);
        const receipt = await this.send(sessionId, data);
        if (receipt) {
          void receipt.completed.catch(fail);
          await receipt.sent;
          if (!data.includes('\x1b[200~')) {
            void receipt.completed.then(() => batch.forEach(item => item.resolve()),
              error => batch.forEach(item => item.reject(error)));
            continue;
          }
          await receipt.completed;
        }
        // Keep this session queue alive through the post-ACK paste gap, even
        // when Enter arrives in a later task after the queue was empty.
        if (data.endsWith('\x1b[201~')) await new Promise(resolve => setTimeout(resolve, 180));
        batch.forEach(item => item.resolve());
      } catch (error) {
        // Never submit a queued Enter after its paste failed, or retry input
        // whose delivery is unknown. A later explicit user input can retry.
        fail(error);
        batch.forEach(item => item.reject(error));
      }
    }
    this.sessions.delete(sessionId);
  }
}
