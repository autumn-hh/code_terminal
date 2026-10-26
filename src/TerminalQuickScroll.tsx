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
  const dragRef = useRef<{ id: number; offset: number } | null>(null);
  const available = !value.program && value.max > 0;
  const percentage = value.max > 0 ? Math.round(value.position / value.max * 100) : 0;
  const fraction = value.max > 0 ? Math.max(0, Math.min(1, value.position / value.max)) : 0;
  const thumbHeight = 'clamp(32px, ' + value.viewport / Math.max(1, value.max + value.viewport) * 100 + '%, 100%)';

  function moveTo(clientY: number, offset: number) {
    const rail = railRef.current;
    if (!rail) return;
    const rect = rail.getBoundingClientRect();
    const thumb = rail.firstElementChild as HTMLElement;
    const distance = rect.height - thumb.getBoundingClientRect().height;
    if (distance > 0) onPosition(Math.max(0, Math.min(1, (clientY - rect.top - offset) / distance)) * value.max);
  }

  function start(event: PointerEvent<HTMLElement>) {
    if (!available || dragRef.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    const rail = railRef.current;
    if (!rail) return;
    const thumb = rail.firstElementChild as HTMLElement;
    const onThumb = thumb.contains(event.target as Node);
    event.preventDefault();
    if (!onThumb) {
      onStep((event.clientY < thumb.getBoundingClientRect().top ? -1 : 1) * Math.max(1, value.viewport - 1));
      return;
    }
    dragRef.current = { id: event.pointerId, offset: event.clientY - thumb.getBoundingClientRect().top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!available) { stop(event); return; }
    event.preventDefault();
    moveTo(event.clientY, drag.offset);
  }

  function stop(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!available) return null;
  return (
    <div className="terminal-quick-scroll" role="group" aria-label={label + "快速滚动"}>
      <div className="terminal-quick-scroll-track" ref={railRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
        <button type="button" className="terminal-quick-scroll-grip"
          style={{ height: thumbHeight, top: 'calc((100% - ' + thumbHeight + ') * ' + fraction + ')' }}
          role="slider" aria-label={label + "拖动手柄"}
          aria-orientation="vertical"
          aria-valuemin={0} aria-valuemax={value.max}
          aria-valuenow={Math.round(value.position)}
          title={'拖动查看历史（' + percentage + '%）；点击轨道翻页'}
          onKeyDown={event=>{
            const page = Math.max(1, value.viewport - 1);
            const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page };
            if (event.key in steps) { event.preventDefault(); event.stopPropagation(); onStep(steps[event.key]); }
            else if (event.key === 'Home' || event.key === 'End') {
              event.preventDefault(); event.stopPropagation(); onPosition(event.key === 'Home' ? 0 : value.max);
            }
          }} />
      </div>
    </div>
  );
}
