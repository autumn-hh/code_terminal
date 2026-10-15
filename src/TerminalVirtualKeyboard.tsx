import { Keyboard, X } from "lucide-react";
import { compactVirtualKeys, getVirtualKey, initialVirtualKeyModifiers } from "./virtualKeyboard";
import type { VirtualKey, VirtualKeyModifiers } from "./virtualKeyboard";

interface VirtualKeyboardProps {
  onKey: (key: VirtualKey, modifiers: VirtualKeyModifiers) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ onKey, onClose }: VirtualKeyboardProps) {
  return (
    <section aria-label="虚拟键盘" className="virtual-keyboard" id="terminal-virtual-keyboard">
      <header className="virtual-keyboard-header">
        <strong><Keyboard size={13} />功能键</strong>
        <span>文字使用系统输入法</span>
        <button aria-label="收起虚拟键盘" onClick={onClose} onPointerDown={(event) => event.preventDefault()} type="button">
          <X size={15} />
        </button>
      </header>
      <div aria-label="终端功能键" className="compact-keyboard-deck">
        {compactVirtualKeys.map(({ id, code, label, modifiers }) => (
          <button
            aria-label={label}
            className={["virtual-key", id === "enter" ? "enter" : "", code.startsWith("Arrow") ? "arrow" : ""].join(" ")}
            data-key-id={id}
            data-keycode={code}
            key={id}
            onClick={() => onKey(getVirtualKey(code), { ...initialVirtualKeyModifiers, ...modifiers })}
            onPointerDown={(event) => event.preventDefault()}
            title={label}
            type="button"
          >
            <span className="keycap-legend">{label}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
