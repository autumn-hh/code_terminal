type PendingWrite = { data: string; wheel: string | null; resolve: () => void; reject: (error: unknown) => void };

function wheelKey(data: string) {
  const events = data.match(/\x1b\[<6[45];\d+;\d+M/g);
  return events?.join('') === data && events.every(event => event === events[0]) ? events[0] : null;
}

// One request in flight per PTY. Bound wheel batches so the program can render
// intermediate frames; normal input and bracketed paste remain separate writes.
export class TerminalInputQueue {
  private sessions = new Map<string, PendingWrite[]>();

  constructor(private send: (sessionId: string, data: string) => Promise<void>) {}

  write(sessionId: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pending = this.sessions.get(sessionId);
      const write = { data, wheel: wheelKey(data), resolve, reject };
      if (pending) {
        // Keep only a short pending wheel burst. Reversal supersedes stale
        // wheel intent, and a long drag must not keep scrolling after release.
        // Never cross a typed-input boundary or cancel an in-flight request.
        if (write.wheel) {
          while (pending[pending.length - 1]?.wheel && (pending[pending.length - 1]!.wheel !== write.wheel ||
            pending.slice(-3).filter(item => item.wheel === write.wheel).length >= 3)) {
            pending.pop()!.resolve();
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
    let pasteReadyAt = 0;
    while (queue.length) {
      const batch = [queue.shift()!];
      while (batch[0].wheel && queue[0]?.wheel === batch[0].wheel && batch.length < 3) batch.push(queue.shift()!);
      const data = batch.map(item => item.data).join('');
      try {
        if (data === '\r' && pasteReadyAt > Date.now()) {
          await new Promise(resolve => setTimeout(resolve, pasteReadyAt - Date.now()));
        }
        await this.send(sessionId, data);
        pasteReadyAt = data.endsWith('\x1b[201~') ? Date.now() + 180 : 0;
        batch.forEach(item => item.resolve());
      } catch (error) {
        // Never submit a queued Enter after its paste failed, or retry input
        // whose delivery is unknown. A later explicit user input can retry.
        [...batch, ...queue.splice(0)].forEach(item => item.reject(error));
      }
    }
    this.sessions.delete(sessionId);
  }
}
