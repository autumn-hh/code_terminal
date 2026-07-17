type ScheduleTimer = (callback: () => void, delayMs: number) => number;
type CancelTimer = (timer: number) => void;

export class TerminalCursorController {
  private generation = 0;
  private revealTimer: number | null = null;
  private suppressed = false;

  constructor(
    private readonly onVisibilityChange: (suppressed: boolean) => void,
    private readonly scheduleTimer: ScheduleTimer = (callback, delayMs) => window.setTimeout(callback, delayMs),
    private readonly cancelTimer: CancelTimer = (timer) => window.clearTimeout(timer),
  ) {}

  isSuppressed() {
    return this.suppressed;
  }

  suppress() {
    this.invalidateReveal();
    this.updateSuppressed(true);
  }

  revealNow() {
    this.invalidateReveal();
    this.updateSuppressed(false);
  }

  revealAfter(delayMs: number, canReveal: () => boolean, onReveal?: () => void) {
    if (!this.suppressed) return;

    const generation = this.invalidateReveal();
    this.revealTimer = this.scheduleTimer(() => {
      if (generation !== this.generation) return;
      this.revealTimer = null;
      if (!canReveal()) return;
      this.updateSuppressed(false);
      onReveal?.();
    }, delayMs);
  }

  dispose() {
    this.invalidateReveal();
  }

  private invalidateReveal() {
    this.generation += 1;
    if (this.revealTimer !== null) {
      this.cancelTimer(this.revealTimer);
      this.revealTimer = null;
    }
    return this.generation;
  }

  private updateSuppressed(suppressed: boolean) {
    if (suppressed === this.suppressed) return;
    this.suppressed = suppressed;
    this.onVisibilityChange(suppressed);
  }
}
