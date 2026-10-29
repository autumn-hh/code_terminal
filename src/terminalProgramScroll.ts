// A TUI does not publish its total history. The range is estimated, but movement
// must come from matching rendered text, never from wheel deltas or sent keys.
export class TerminalProgramScroll {
  distance = 0;
  range: number;
  private rows: string[] = [];
  private columns = 0;
  private intentUntil = -1;

  constructor(viewport: number) {
    this.range = Math.max(1, viewport) * 20;
  }

  get fraction() {
    return 1 - this.distance / this.range;
  }

  request(now: number) {
    this.intentUntil = now + 2500;
  }

  observe(rows: string[], columns: number, now: number) {
    const previous = this.rows;
    const resized = this.columns !== columns || previous.length !== rows.length;
    this.rows = rows;
    this.columns = columns;
    if (resized || now > this.intentUntil) return;
    const movement = renderedRowMovement(previous, rows);
    if (movement !== null) this.scroll(movement, rows.length);
  }

  scroll(lines: number, viewport: number) {
    if (!Number.isFinite(lines)) return;
    this.distance = Math.max(0, this.distance - lines);
    // Reserve unexplored history instead of treating the current range as a real top.
    // Keep the expanded range on the return trip; shrinking it would lose progress.
    this.range = Math.max(this.range, this.distance + Math.max(1, viewport) * 10);
  }

}

// Ignore stationary chrome, blank/border lines and repeated text. At least two
// distinct content lines must agree on the displacement. Ambiguous full-screen
// replacements have no measurable position; keeping the grip is safer than
// inventing movement. Positive means the viewport moved toward newer content.
export function renderedRowMovement(before: string[], after: string[]): number | null {
  const uniqueRows = (rows: string[]) => {
    const index = new Map<string, number>();
    rows.forEach((text, row) => {
      if (text.replace(/[^\p{L}\p{N}]/gu, '').length < 4) return;
      index.set(text, index.has(text) ? -1 : row);
    });
    return index;
  };
  const oldRows = uniqueRows(before), newRows = uniqueRows(after);
  const votes = new Map<number, number>();
  for (const [text, oldRow] of oldRows) {
    const newRow = newRows.get(text);
    if (oldRow < 0 || newRow === undefined || newRow < 0 || newRow === oldRow) continue;
    const shift = oldRow - newRow;
    votes.set(shift, (votes.get(shift) ?? 0) + 1);
  }
  const ranked = [...votes].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] < 2 || (ranked[1] && ranked[0][1] <= ranked[1][1])) return null;
  return ranked[0][0];
}
