import { useEffect, useRef, useState, type RefObject } from "react";
import type { Terminal } from "@xterm/xterm";
import { copyTerminalText } from "./terminalClipboard";

type Point = { x: number; y: number };
type Selection = { text: string; x: number; y: number; start?: Point; end?: Point };

export function TerminalSelection({ terminal, hostRef, logRef, mode, visible, onPaste }: {
  terminal: Terminal | null;
  hostRef: RefObject<HTMLDivElement>;
  logRef: RefObject<HTMLDivElement>;
  mode: "terminal" | "dialog";
  visible: boolean;
  onPaste: (text: string) => void;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [status, setStatus] = useState("");
  const [touchSelection, setTouchSelection] = useState(false);
  const controllerRef = useRef<{
    adjust: (edge: "start" | "end", x: number, y: number) => void;
    clear: () => void;
  } | null>(null);

  useEffect(() => {
    const host = hostRef.current, log = logRef.current, root = rootRef.current;
    if (!terminal || !host || !log || !root || !visible) { setSelection(null); return; }
    let touch: { id: number; x: number; y: number; anchor: number; selecting: boolean } | null = null;
    let timer: number | undefined;
    let usingTouch = false;
    let lastText = "";
    let replaying = false;
    let pointerSelecting = false;
    let disposed = false;
    let mouse: { event: MouseEvent; target: EventTarget; anchor: number; dragging: boolean } | null = null;
    const cancelTimer = () => { window.clearTimeout(timer); timer = undefined; };
    const geometry = () => {
      const screen = host.querySelector('.xterm-screen')?.getBoundingClientRect();
      return screen && screen.width && screen.height ? { screen, cw: screen.width / terminal.cols, ch: screen.height / terminal.rows } : null;
    };
    const cellAt = (x: number, y: number) => {
      const g = geometry();
      if (!g) return 0;
      const row = Math.max(0, Math.min(terminal.rows - 1, Math.floor((y - g.screen.top) / g.ch))) + terminal.buffer.active.viewportY;
      let col = Math.max(0, Math.min(terminal.cols - 1, Math.floor((x - g.screen.left) / g.cw)));
      if (col && terminal.buffer.active.getLine(row)?.getCell(col)?.getWidth() === 0) col--;
      return row * terminal.cols + col;
    };
    const cellEnd = (cell: number) => cell + Math.max(1, terminal.buffer.active.getLine(Math.floor(cell / terminal.cols))?.getCell(cell % terminal.cols)?.getWidth() ?? 1);
    const select = (start: number, end: number) => {
      terminal.select(start % terminal.cols, Math.floor(start / terminal.cols), Math.max(1, end - start));
      sync();
    };
    const locate = (x: number, y: number): Point => {
      const g = geometry()!, bounds = root.getBoundingClientRect();
      const scale = bounds.width / root.clientWidth || 1;
      return { x: Math.max(8, Math.min(root.clientWidth - 8, (g.screen.left - bounds.left + x * g.cw) / scale)),
        y: Math.max(4, Math.min(root.clientHeight - 16, (g.screen.top - bounds.top + (y - terminal.buffer.active.viewportY + 1) * g.ch) / scale)) };
    };
    function publish(next: Selection | null) {
      if ((next?.text ?? "") !== lastText) { lastText = next?.text ?? ""; setStatus(""); }
      setSelection(next);
    }
    function sync() {
      if (disposed || pointerSelecting) return;
      const bounds = root!.getBoundingClientRect();
      const scale = bounds.width / root!.clientWidth || 1;
      const width = Math.min(root!.clientWidth, (window.innerWidth - bounds.left) / scale);
      const viewportBottom = window.visualViewport ? window.visualViewport.offsetTop + window.visualViewport.height : window.innerHeight;
      const height = Math.min(root!.clientHeight, (viewportBottom - bounds.top) / scale);
      if (mode === "dialog") {
        const native = window.getSelection();
        if (!native || native.isCollapsed || !log!.contains(native.anchorNode) || !log!.contains(native.focusNode)) { publish(null); return; }
        const rect = native.getRangeAt(0).getBoundingClientRect();
        const top = (rect.top - bounds.top) / scale, bottom = (rect.bottom - bounds.top) / scale;
        publish({ text: native.toString(), x: Math.max(4, Math.min(width - Math.min(280, width - 8) - 4, (rect.left - bounds.left) / scale)),
          y: Math.max(4, Math.min(height - 84, top >= 52 ? top - 52 : bottom + 8)) });
        return;
      }
      const range = terminal!.getSelectionPosition(), text = terminal!.getSelection();
      if (!range || !text || !geometry()) { publish(null); return; }
      const start = locate(range.start.x, range.start.y), end = locate(range.end.x, range.end.y);
      publish({ text, start, end, x: Math.max(4, Math.min(width - Math.min(280, width - 8) - 4, start.x)),
        y: Math.max(4, Math.min(height - 84, start.y >= 80 ? start.y - geometry()!.ch / scale - 52 : end.y + 20)) });
    }
    const clear = () => {
      cancelTimer(); touch = null; usingTouch = false; delete host.dataset.selecting;
      setTouchSelection(false); terminal.clearSelection(); publish(null);
    };
    controllerRef.current = {
      clear,
      adjust(edge, x, y) {
        const range = terminal.getSelectionPosition();
        if (!range) return;
        const start = range.start.y * terminal.cols + range.start.x, end = range.end.y * terminal.cols + range.end.x;
        const cell = cellAt(x, y);
        if (edge === "start") select(Math.min(cell, end - 1), end);
        else select(start, Math.max(start + 1, cellEnd(cell)));
      },
    };
    const touchStart = (event: TouchEvent) => {
      if (mode !== "terminal") return;
      cancelTimer();
      if (event.touches.length !== 1) { touch = null; return; }
      clear();
      const point = event.touches[0];
      touch = { id: point.identifier, x: point.clientX, y: point.clientY, anchor: cellAt(point.clientX, point.clientY), selecting: false };
      timer = window.setTimeout(() => {
        if (!touch) return;
        touch.selecting = true; usingTouch = true; host.dataset.selecting = "true";
        setTouchSelection(true);
        const row = Math.floor(touch.anchor / terminal.cols), line = terminal.buffer.active.getLine(row);
        let start = touch.anchor % terminal.cols, end = start + 1;
        // Long-press starts with a word; handles can then select arbitrary cells.
        const word = (column: number) => /[\p{L}\p{N}_./:-]/u.test(line?.getCell(column)?.getChars() ?? "");
        if (word(start)) {
          while (start > 0 && word(start - 1)) start--;
          while (end < terminal.cols && word(end)) end++;
        }
        touch.anchor = row * terminal.cols + start;
        select(touch.anchor, cellEnd(row * terminal.cols + end - 1));
      }, 450);
    };
    const touchMove = (event: TouchEvent) => {
      if (!touch) return;
      if (event.touches.length !== 1) { cancelTimer(); touch = null; return; }
      const point = Array.from(event.touches).find(t => t.identifier === touch!.id);
      if (!point) return;
      if (!touch.selecting) {
        if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) > 8) { cancelTimer(); touch = null; }
        return;
      }
      event.preventDefault(); event.stopImmediatePropagation();
      const cell = cellAt(point.clientX, point.clientY);
      select(Math.min(touch.anchor, cell), cellEnd(Math.max(touch.anchor, cell)));
    };
    const touchEnd = (event: TouchEvent) => {
      cancelTimer();
      if (touch?.selecting) { event.preventDefault(); event.stopImmediatePropagation(); }
      touch = null;
    };
    const contextMenu = (event: Event) => { if (usingTouch || timer !== undefined) event.preventDefault(); };
    const mouseDown = (event: MouseEvent) => {
      if (replaying || mode !== "terminal" || event.button !== 0 || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
      if (terminal.modes.mouseTrackingMode === "none" || !(event.target instanceof Element) || !event.target.closest('.xterm-screen')) return;
      // Delay only the click while distinguishing a text drag from a TUI click.
      event.preventDefault(); event.stopImmediatePropagation();
      mouse = { event, target: event.target, anchor: cellAt(event.clientX, event.clientY), dragging: false };
    };
    const mouseMove = (event: MouseEvent) => {
      if (!mouse) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!mouse.dragging && Math.hypot(event.clientX - mouse.event.clientX, event.clientY - mouse.event.clientY) < 4) return;
      mouse.dragging = true;
      const cell = cellAt(event.clientX, event.clientY);
      select(Math.min(mouse.anchor, cell), cellEnd(Math.max(mouse.anchor, cell)));
    };
    const mouseUp = (event: MouseEvent) => {
      if (!mouse || replaying) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const pending = mouse; mouse = null;
      if (!pending.dragging) {
        terminal.clearSelection();
        replaying = true;
        pending.target.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, clientX:pending.event.clientX, clientY:pending.event.clientY, button:0, buttons:1, detail:pending.event.detail }));
        pending.target.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, clientX:event.clientX, clientY:event.clientY, button:0, buttons:0, detail:event.detail }));
        replaying = false;
      }
      sync();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && lastText) { event.preventDefault(); event.stopPropagation(); clear(); window.getSelection()?.removeAllRanges(); }
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.parentElement?.contains(event.target)) clear();
      else if (event.pointerType === 'mouse' && event.button === 0 && event.target instanceof Node &&
        (host.contains(event.target) || log.contains(event.target))) {
        pointerSelecting = true;
        setSelection(null);
      }
    };
    const pointerUp = () => { pointerSelecting = false; window.setTimeout(sync, 0); };
    const selected = terminal.onSelectionChange(sync);
    const scrolled = terminal.onScroll(sync);
    const resized = terminal.onResize(() => { if (mode === 'dialog') sync(); else clear(); });
    const parsed = terminal.onWriteParsed(() => {
      // Do not offer stale coordinates after a TUI redraw replaces selected text.
      if (mode === 'terminal' && lastText && terminal.getSelection() !== lastText) clear();
    });
    const observer = new ResizeObserver(sync); observer.observe(root);
    document.addEventListener('selectionchange', sync);
    document.addEventListener('keydown', escape, true);
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('pointerup', pointerUp, true);
    log.addEventListener('scroll', sync, {passive:true});
    host.addEventListener('touchstart', touchStart, {capture:true,passive:true});
    host.addEventListener('touchmove', touchMove, {capture:true,passive:false});
    host.addEventListener('touchend', touchEnd, {capture:true,passive:false});
    host.addEventListener('touchcancel', clear);
    host.addEventListener('contextmenu', contextMenu, true);
    host.addEventListener('mousedown', mouseDown, true);
    document.addEventListener('mousemove', mouseMove, true);
    document.addEventListener('mouseup', mouseUp, true);
    sync();
    return () => {
      disposed = true;
      cancelTimer(); delete host.dataset.selecting; controllerRef.current = null;
      setTouchSelection(false); setSelection(null);
      selected.dispose(); scrolled.dispose(); resized.dispose(); parsed.dispose(); observer.disconnect();
      document.removeEventListener('selectionchange', sync);
      document.removeEventListener('keydown', escape, true);
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('pointerup', pointerUp, true);
      log.removeEventListener('scroll', sync);
      host.removeEventListener('touchstart', touchStart, true);
      host.removeEventListener('touchmove', touchMove, true);
      host.removeEventListener('touchend', touchEnd, true);
      host.removeEventListener('touchcancel', clear);
      host.removeEventListener('contextmenu', contextMenu, true);
      host.removeEventListener('mousedown', mouseDown, true);
      document.removeEventListener('mousemove', mouseMove, true);
      document.removeEventListener('mouseup', mouseUp, true);
    };
  }, [terminal, hostRef, logRef, mode, visible]);

  return <div ref={rootRef} className="terminal-selection-layer">
    {selection && <>
      <div className="terminal-selection-actions" role="group" aria-label="选中文字操作"
        style={{left:selection.x,top:selection.y}} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); }}>
        <button type="button" onClick={async () => {
          try { await copyTerminalText(selection.text); setStatus('已复制'); }
          catch { setStatus('复制未成功，请重试或使用系统复制菜单。'); }
        }}>复制到剪贴板</button>
        <button type="button" onClick={() => { onPaste(selection.text); controllerRef.current?.clear(); window.getSelection()?.removeAllRanges(); }}>粘贴到输入栏</button>
        {status && <span role="status">{status}</span>}
      </div>
      {touchSelection && (['start','end'] as const).map(edge => selection[edge] && <button
        key={edge} type="button" className={'terminal-selection-handle '+edge} aria-label={edge==='start'?'调整选区起点':'调整选区终点'}
        style={{left:selection[edge]!.x,top:selection[edge]!.y}}
        onPointerDown={event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if(event.currentTarget.hasPointerCapture(event.pointerId)) { event.preventDefault(); controllerRef.current?.adjust(edge,event.clientX,event.clientY - 12); } }}
        onPointerUp={event => { event.preventDefault(); if(event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      />)}
    </>}
  </div>;
}
