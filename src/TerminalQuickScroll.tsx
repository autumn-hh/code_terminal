import { useEffect, useRef, useState } from "react";
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
  const dragRef = useRef<{ id: number; offset: number; lastY: number; remainder: number; program: boolean } | null>(null);
  const [programFraction, setProgramFraction] = useState(1);
  const edgeFrameRef = useRef<number | null>(null);
  const edgeDirectionRef = useRef(0);
  const stepRef = useRef(onStep);
  stepRef.current = onStep;
  const available = value.program || value.max > 0;
  const percentage = value.max > 0 ? Math.round(value.position / value.max * 100) : 0;
  const fraction = value.program ? programFraction : value.max > 0 ? Math.max(0, Math.min(1, value.position / value.max)) : 0;
  const thumbHeight = value.program ? 'min(48px, 100%)' : 'clamp(32px, ' + value.viewport / Math.max(1, value.max + value.viewport) * 100 + '%, 100%)';

  function stopEdgeScroll() {
    edgeDirectionRef.current = 0;
    if (edgeFrameRef.current !== null) cancelAnimationFrame(edgeFrameRef.current);
    edgeFrameRef.current = null;
  }

  useEffect(() => {
    const cancel = () => { dragRef.current = null; stopEdgeScroll(); };
    const onVisibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      cancel();
      window.removeEventListener('blur', cancel);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  function setEdgeScroll(direction: number) {
    if (direction === edgeDirectionRef.current) return;
    stopEdgeScroll();
    if (!direction) return;
    edgeDirectionRef.current = direction;
    let lastStep = performance.now();
    const tick = (now: number) => {
      if (!dragRef.current?.program) { stopEdgeScroll(); return; }
      if (now - lastStep >= 100) {
        stepRef.current(direction * 3);
        lastStep = now;
      }
      edgeFrameRef.current = requestAnimationFrame(tick);
    };
    edgeFrameRef.current = requestAnimationFrame(tick);
  }

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
      const direction = event.clientY < thumb.getBoundingClientRect().top ? -1 : 1;
      onStep(direction * Math.max(1, value.viewport - 1));
      if (value.program) {
        const rect = rail.getBoundingClientRect();
        const distance = rect.height - thumb.getBoundingClientRect().height;
        if (distance > 0) setProgramFraction(Math.max(0, Math.min(1, (event.clientY - rect.top - thumb.offsetHeight / 2) / distance)));
      }
      return;
    }
    dragRef.current = { id: event.pointerId, offset: event.clientY - thumb.getBoundingClientRect().top,
      lastY: event.clientY, remainder: 0, program: Boolean(value.program) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function move(event: PointerEvent<HTMLElement>) {
    const drag = dragRef.current;
    if (!drag || drag.id !== event.pointerId) return;
    if (!available || drag.program !== Boolean(value.program)) { stop(event); return; }
    event.preventDefault();
    if (value.program) {
      const rail = railRef.current;
      if (!rail) return;
      const rect = rail.getBoundingClientRect();
      const thumb = rail.firstElementChild as HTMLElement;
      const distance = rect.height - thumb.getBoundingClientRect().height;
      const delta = event.clientY - drag.lastY;
      drag.lastY = event.clientY;
      drag.remainder += delta;
      const lines = Math.trunc(drag.remainder / 8);
      if (lines) { onStep(lines); drag.remainder -= lines * 8; }
      const next = distance > 0 ? Math.max(0, Math.min(1, (event.clientY - rect.top - drag.offset) / distance)) : 0;
      setProgramFraction(next);
      setEdgeScroll(next === 0 && delta < 0 ? -1 : next === 1 && delta > 0 ? 1 : 0);
      return;
    }
    moveTo(event.clientY, drag.offset);
  }

  function stop(event: PointerEvent<HTMLElement>) {
    if (dragRef.current?.id !== event.pointerId) return;
    dragRef.current = null;
    stopEdgeScroll();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  if (!available) return null;
  return (
    <div className="terminal-quick-scroll" role="group" aria-label={label + "快速滚动"}>
      <div className="terminal-quick-scroll-track" ref={railRef}
        onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop}>
        <button type="button" className="terminal-quick-scroll-grip"
          style={{ height: thumbHeight, top: 'calc((100% - ' + thumbHeight + ') * ' + fraction + ')' }}
          role={value.program ? undefined : 'slider'} aria-label={label + "拖动手柄"}
          aria-orientation={value.program ? undefined : 'vertical'}
          aria-valuemin={value.program ? undefined : 0} aria-valuemax={value.program ? undefined : value.max}
          aria-valuenow={value.program ? undefined : Math.round(value.position)}
          title={value.program ? '上下拖动滚动 TUI，拖到边缘按住继续滚动；点击轨道翻页' : '拖动查看历史（' + percentage + '%）；点击轨道翻页'}
          onKeyDown={event=>{
            const page = Math.max(1, value.viewport - 1);
            const steps: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -page, PageDown: page };
            if (event.key in steps) { event.preventDefault(); event.stopPropagation(); onStep(steps[event.key]); }
            else if (!value.program && (event.key === 'Home' || event.key === 'End')) {
              event.preventDefault(); event.stopPropagation(); onPosition(event.key === 'Home' ? 0 : value.max);
            }
          }} />
      </div>
    </div>
  );
}
