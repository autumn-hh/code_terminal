import { useRef } from "react";
import type { PointerEvent } from "react";

export interface ScrollPosition {
  position: number;
  max: number;
  viewport: number;
  program?: boolean;
}

interface Props {
  value: ScrollPosition;
  label: string;
  onPosition: (position: number) => void;
  onStep: (direction: number) => void;
}

export function TerminalQuickScroll({ value, label, onPosition, onStep }: Props) {
  const railRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: number; offset: number; lastY: number; program: boolean } | null>(null);
  const available = value.program || value.max > 0;
  const percentage = value.max > 0 ? Math.round(value.position / value.max * 100) : 0;

  function moveTo(clientY: number, offset: number) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const thumb = rail.firstElementChild as HTMLElement;
    const distance = rect.height - thumb.offsetHeight;
    if (distance > 0) onPosition(Math.max(0, Math.min(1, (clientY - rect.top - offset) / distance)) * value.max);
  }

  function start(event: PointerEvent<HTMLElement>) {
    if (!available || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rail = railRef.current;
    if (!rail) return;
    const thumb = rail.firstElementChild as HTMLElement;
    const onThumb = thumb.contains(event.target as Node);
    const offset = onThumb ? event.clientY - thumb.getBoundingClientRect().top : thumb.offsetHeight / 2;
    dragRef.current = { id: event.pointerId, offset, lastY: event.clientY, program: Boolean(value.program) };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    if (!value.program && !onThumb) moveTo(event.clientY, offset);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (drag.program !== Boolean(value.program)) { stop(event); return; }
    event.preventDefault();
    if (value.program) {
      const lines = Math.trunc((event.clientY - drag.lastY) / 8);
      if (lines) { onStep(lines); drag.lastY = event.clientY; }
    } else {
      moveTo(event.clientY, drag.offset);
    }
  }

  function stop(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!available) return null;
  return (
    <div className="terminal-quick-scroll" role="group" aria-label={label + "快速滚动"}>
      <button type="button" className="terminal-quick-scroll-step" aria-label={label + "向上翻动"}
        title="向上翻动" onPointerDown={event=>event.preventDefault()} onClick={()=>onStep(-Math.max(1, value.viewport - 1))}>⌃</button>
      <div className="terminal-quick-scroll-track" ref={railRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
        <button type="button" className={'terminal-quick-scroll-grip' + (value.program ? ' program' : '')}
          style={{ top: value.program ? '50%' : 'calc((100% - 48px) * ' + percentage / 100 + ')' }}
          role={value.program ? undefined : 'slider'} aria-label={label + "拖动手柄"}
          aria-orientation={value.program ? undefined : 'vertical'}
          aria-valuemin={value.program ? undefined : 0} aria-valuemax={value.program ? undefined : value.max}
          aria-valuenow={value.program ? undefined : Math.round(value.position)}
          title={value.program ? '上下拖动控制 TUI 滚动；也可点击上下按钮翻动' : '上下拖动快速定位（' + percentage + '%）'}
          onKeyDown={event=>{
            const page = Math.max(1, value.viewport - 1);
            const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page };
            if (event.key in steps) { event.preventDefault(); event.stopPropagation(); onStep(steps[event.key]); }
            else if (!value.program && (event.key === 'Home' || event.key === 'End')) {
              event.preventDefault(); event.stopPropagation(); onPosition(event.key === 'Home' ? 0 : value.max);
            }
          }}><span aria-hidden="true">⋮</span></button>
      </div>
      <button type="button" className="terminal-quick-scroll-step" aria-label={label + "向下翻动"}
        title="向下翻动" onPointerDown={event=>event.preventDefault()} onClick={()=>onStep(Math.max(1, value.viewport - 1))}>⌄</button>
    </div>
  );
}
