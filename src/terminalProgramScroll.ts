// Program-managed TUIs do not expose their scrollback length. Keep distance in
// logical lines, never in clamped thumb pixels, so long round trips are reversible.
export class TerminalProgramScroll {
  distance = 0;
  range: number;

  constructor(viewport: number) {
    this.range = Math.max(1, viewport) * 20;
  }

  get fraction() {
    return 1 - this.distance / this.range;
  }

  scroll(lines: number, viewport: number) {
    if (!Number.isFinite(lines)) return;
    this.distance = Math.max(0, this.distance - lines);
    // Reserve unexplored history instead of treating the current range as a real top.
    // Keep the expanded range on the return trip; shrinking it would lose progress.
    this.range = Math.max(this.range, this.distance + Math.max(1, viewport) * 10);
  }

  stepTo(fraction: number, range = this.range) {
    const target = (1 - Math.max(0, Math.min(1, fraction))) * range;
    // Match the terminal's per-event wheel limit. Only account for steps actually sent.
    return Math.max(-40, Math.min(40, Math.round(this.distance - target)));
  }
}
