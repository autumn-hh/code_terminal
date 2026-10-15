import { Delete, Keyboard, Lightbulb, X } from "lucide-react";
import { useState } from "react";
import type { CSSProperties } from "react";
import { compactVirtualKeys, getVirtualKey, initialVirtualKeyModifiers, keyboardLightEffects } from "./virtualKeyboard";
import type { KeyboardLightEffect, VirtualKey, VirtualKeyModifiers } from "./virtualKeyboard";

const lightStorageKey = "code-terminal.keyboard-light";

function readLightEffect(): KeyboardLightEffect {
  try {
    const saved = localStorage.getItem(lightStorageKey);
    return keyboardLightEffects.find((effect) => effect.id === saved)?.id ?? "wave";
  } catch {
    return "wave";
  }
}

interface VirtualKeyboardProps {
  modifiers: VirtualKeyModifiers;
  onModifiersChange: (modifiers: VirtualKeyModifiers) => void;
  onKey: (key: VirtualKey, modifiers: VirtualKeyModifiers) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ modifiers, onModifiersChange, onKey, onClose }: VirtualKeyboardProps) {
  const [lightEffect, setLightEffect] = useState(readLightEffect);
  const effect = keyboardLightEffects.find((item) => item.id === lightEffect)!;
  const activeModifiers = [modifiers.ctrl && "Ctrl", modifiers.alt && "Alt", modifiers.shift && "Shift"].filter(Boolean).join(" + ");

  function cycleLightEffect() {
    const next = keyboardLightEffects[(keyboardLightEffects.indexOf(effect) + 1) % keyboardLightEffects.length];
    setLightEffect(next.id);
    try { localStorage.setItem(lightStorageKey, next.id); } catch { /* Keep the selection in memory. */ }
  }

  function pressKey(key: VirtualKey) {
    if (key.modifier) {
      onModifiersChange({ ...modifiers, [key.modifier]: !modifiers[key.modifier] });
    } else {
      onKey(key, modifiers);
    }
  }

  return (
    <section aria-label="虚拟键盘" className="virtual-keyboard" data-light-effect={lightEffect} id="terminal-virtual-keyboard">
      <header className="virtual-keyboard-header">
        <strong><Keyboard size={13} />功能键</strong>
        <span aria-live="polite">{activeModifiers ? `${activeModifiers} · 等待下一个按键` : "文字使用系统输入法"}</span>
        <button aria-label="收起虚拟键盘" onClick={onClose} onPointerDown={(event) => event.preventDefault()} type="button">
          <X size={15} />
        </button>
      </header>
      <div aria-label="终端功能键" className="compact-keyboard-deck">
        {compactVirtualKeys.map(({ code, area, label }, index) => {
          const key = getVirtualKey(code);
          const active = key.modifier ? modifiers[key.modifier] : false;
          return (
            <button
              aria-label={key.label}
              aria-pressed={key.modifier ? active : undefined}
              className={`virtual-key ${active ? "active" : ""} ${code === "Enter" ? "enter" : ""} ${code.startsWith("Arrow") ? "arrow" : ""}`}
              data-keycode={code}
              key={code}
              onClick={() => pressKey(key)}
              onPointerDown={(event) => event.preventDefault()}
              style={{ gridArea: area, "--light-delay": `${index * -0.17}s` } as CSSProperties}
              title={key.modifier ? `${key.label}：与下一个功能键或系统键盘输入组合` : key.label}
              type="button"
            >
              <span className="keycap-legend">{code === "Backspace" ? <Delete size={18} /> : label ?? key.label}</span>
            </button>
          );
        })}
        <button
          aria-label="Ctrl+C：中断当前操作"
          className="virtual-key interrupt"
          data-shortcut="interrupt"
          onClick={() => onKey(getVirtualKey("KeyC"), { ...initialVirtualKeyModifiers, ctrl: true })}
          onPointerDown={(event) => event.preventDefault()}
          style={{ gridArea: "interrupt", "--light-delay": "-2.7s" } as CSSProperties}
          type="button"
        >
          <span className="keycap-legend">Ctrl+C</span>
        </button>
        <button
          aria-label={`切换键盘灯效，当前：${effect.label}`}
          className="virtual-key keyboard-light-switch"
          data-action="cycle-light"
          onClick={cycleLightEffect}
          onPointerDown={(event) => event.preventDefault()}
          style={{ gridArea: "light", "--light-delay": "-2.9s" } as CSSProperties}
          title="切换流光 / 呼吸 / 常亮 / 关闭"
          type="button"
        >
          <span className="keycap-legend"><Lightbulb size={13} /><span>{effect.label}</span></span>
        </button>
      </div>
    </section>
  );
}
