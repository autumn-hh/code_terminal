import { Keyboard, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import {
  getVirtualKeyLabel, initialVirtualKeyModifiers, virtualKeyboardRows, virtualNavigationKeys, virtualNumpadKeys,
} from "./virtualKeyboard";
import type { VirtualKey, VirtualKeyModifiers } from "./virtualKeyboard";

interface VirtualKeyboardProps {
  sessionId: string;
  onKey: (key: VirtualKey, modifiers: VirtualKeyModifiers) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ sessionId, onKey, onClose }: VirtualKeyboardProps) {
  const [modifiers, setModifiers] = useState({ ...initialVirtualKeyModifiers });

  useEffect(() => {
    setModifiers((current) => ({ ...initialVirtualKeyModifiers, capsLock: current.capsLock, numLock: current.numLock }));
  }, [sessionId]);

  function pressKey(key: VirtualKey) {
    if (key.modifier) {
      const name = key.modifier;
      setModifiers((current) => ({ ...current, [name]: !current[name] }));
      return;
    }
    onKey(key, modifiers);
    setModifiers((current) => ({ ...current, shift: false, ctrl: false, alt: false, meta: false }));
  }

  function renderKey(key: VirtualKey, style?: CSSProperties) {
    const active = key.modifier ? modifiers[key.modifier] : false;
    return (
      <button
        aria-label={key.code.startsWith("Numpad") ? `小键盘 ${key.label}` : key.label}
        aria-pressed={key.modifier ? active : undefined}
        className={`virtual-key ${active ? "active" : ""} ${key.code.startsWith("Arrow") ? "arrow" : ""}`}
        data-keycode={key.code}
        disabled={key.disabled}
        key={key.code}
        onClick={() => pressKey(key)}
        onPointerDown={(event) => event.preventDefault()}
        style={style}
        title={key.disabled ? `${key.label}：系统按键，终端不接收此键` : key.modifier ? `${key.label}：点击切换` : key.label}
        type="button"
      >
        {getVirtualKeyLabel(key, modifiers)}
      </button>
    );
  }

  return (
    <section aria-label="电脑全键盘" className="virtual-keyboard" id="terminal-virtual-keyboard">
      <header className="virtual-keyboard-header">
        <strong><Keyboard size={15} />电脑全键盘</strong>
        <span>组合键：先点 Ctrl / Alt / Shift，再点按键</span>
        <button aria-label="收起虚拟键盘" onClick={onClose} onPointerDown={(event) => event.preventDefault()} type="button">
          <X size={16} />
        </button>
      </header>
      <div aria-label="完整键盘，可横向滑动" className="virtual-keyboard-scroll" tabIndex={0}>
        <div className="virtual-keyboard-layout">
          <div aria-label="主键盘" className="virtual-keyboard-main">
            {virtualKeyboardRows.map((row, index) => (
              <div className={`virtual-keyboard-row ${index === 0 ? "function-row" : ""}`} key={index}>
                {row.map((key) => renderKey(key, { flex: `${key.width ?? 1} 0 0` }))}
              </div>
            ))}
          </div>
          <div aria-label="导航键" className="virtual-keyboard-navigation">
            {virtualNavigationKeys.map((key) => renderKey(key, { gridRow: key.row, gridColumn: key.column }))}
          </div>
          <div aria-label="数字小键盘" className="virtual-keyboard-numpad">
            {virtualNumpadKeys.map((key) => renderKey(key, {
              gridRow: `${key.row} / span ${"rowSpan" in key ? key.rowSpan : 1}`,
              gridColumn: `${key.column} / span ${"columnSpan" in key ? key.columnSpan : 1}`,
            }))}
          </div>
        </div>
      </div>
    </section>
  );
}
