import { ArrowUp, Delete, Keyboard, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  aiVirtualKeyShortcuts, commonQuickInputGroups, getVirtualKey, getVirtualKeyLabel,
  initialVirtualKeyModifiers, mobileCommonSymbolKeys, mobileLetterRows, mobileNumberKeys, mobilePunctuationKeys, mobileSymbolPages,
  mobileVirtualKeyboardQuery, openSpecQuickInputs, virtualKeyboardRows, virtualNavigationKeys, virtualNumpadKeys,
} from "./virtualKeyboard";
import type { VirtualKey, VirtualKeyModifiers, VirtualQuickInput } from "./virtualKeyboard";

type KeyboardPanel = "typing" | "functions" | "ai";
type AiCategory = "shortcuts" | "openspec" | "common";

interface VirtualKeyboardProps {
  sessionId: string;
  onKey: (key: VirtualKey, modifiers: VirtualKeyModifiers) => void;
  onText: (text: string) => void;
  onClose: () => void;
}

export function VirtualKeyboard({ sessionId, onKey, onText, onClose }: VirtualKeyboardProps) {
  const [modifiers, setModifiers] = useState({ ...initialVirtualKeyModifiers });
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(mobileVirtualKeyboardQuery).matches);
  const [panel, setPanel] = useState<KeyboardPanel>("functions");
  const [symbols, setSymbols] = useState(false);
  const [symbolPage, setSymbolPage] = useState(0);
  const [aiCategory, setAiCategory] = useState<AiCategory>("shortcuts");
  const [inputNotice, setInputNotice] = useState("");
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = window.matchMedia(mobileVirtualKeyboardQuery);
    const update = () => setIsMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setModifiers((current) => ({ ...initialVirtualKeyModifiers, capsLock: current.capsLock, numLock: current.numLock }));
    setInputNotice("");
  }, [sessionId]);

  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [panel, aiCategory, isMobile, symbols]);

  function resetModifiers() {
    setModifiers((current) => ({ ...current, shift: false, ctrl: false, alt: false, meta: false }));
  }

  function changePanel(next: KeyboardPanel) {
    setPanel(next);
    setInputNotice("");
  }

  function pressKey(key: VirtualKey) {
    if (key.modifier) {
      const name = key.modifier;
      setModifiers((current) => ({ ...current, [name]: !current[name] }));
      return;
    }
    onKey(key, modifiers);
    resetModifiers();
    setInputNotice("");
  }

  function insertQuickInput(input: VirtualQuickInput) {
    onText(input.text);
    resetModifiers();
    setInputNotice('已填入「' + input.label + '」，按回车提交');
  }

  function renderKey(key: VirtualKey, style?: CSSProperties, content?: ReactNode) {
    const active = key.modifier ? modifiers[key.modifier] : false;
    return (
      <button
        aria-label={key.code.startsWith("Numpad") ? '小键盘 ' + key.label : key.label}
        aria-pressed={key.modifier ? active : undefined}
        className={['virtual-key', active ? 'active' : '', key.code.startsWith('Arrow') ? 'arrow' : '', key.code === 'Enter' ? 'enter' : ''].join(' ')}
        data-keycode={key.code}
        disabled={key.disabled}
        key={key.code}
        onClick={() => pressKey(key)}
        onPointerDown={(event) => event.preventDefault()}
        style={style}
        title={key.disabled ? key.label + '：系统按键，终端不接收此键' : key.modifier ? key.label + '：点击切换' : key.label}
        type="button"
      >
        {content ?? getVirtualKeyLabel(key, modifiers)}
      </button>
    );
  }

  function modeButton(label: string, action: () => void) {
    return <button className="virtual-key mode-key" onClick={action} onPointerDown={(event) => event.preventDefault()} type="button">{label}</button>;
  }

  function renderMobileTyping() {
    return (
      <div aria-label={symbols ? "数字与符号键盘" : "手机字母键盘"} className="mobile-typing-keyboard">
        {!symbols && (
          <>
            <div aria-label="数字行" className="mobile-keyboard-row utility-row">
              {mobileNumberKeys.map((key) => renderKey(key))}
            </div>
            <div aria-label="常用符号" className="mobile-keyboard-row utility-row">
              {mobileCommonSymbolKeys.map((key) => renderKey(key))}
            </div>
          </>
        )}
        {(symbols ? mobileSymbolPages[symbolPage] : mobileLetterRows.slice(0, 2)).map((row, index) => (
          <div className={'mobile-keyboard-row ' + (!symbols && index === 1 ? 'indented' : '')} key={String(symbols) + index}>
            {row.map((key) => renderKey(key))}
          </div>
        ))}
        <div className="mobile-keyboard-row">
          {symbols
            ? modeButton(symbolPage === 0 ? "#+=" : "123", () => setSymbolPage((current) => 1 - current))
            : renderKey(getVirtualKey("ShiftLeft"), { flex: 1.4 }, <ArrowUp size={18} />)}
          {(symbols ? mobilePunctuationKeys : mobileLetterRows[2]).map((key) => renderKey(key))}
          {renderKey(getVirtualKey("Backspace"), { flex: 1.4 }, <Delete size={19} />)}
        </div>
        <div className="mobile-keyboard-row bottom-row">
          {modeButton(symbols ? "ABC" : "123", () => { setSymbols((current) => !current); setSymbolPage(0); resetModifiers(); })}
          {renderKey(getVirtualKey("Comma"))}
          {renderKey(getVirtualKey("Space"), { flex: 4.6 }, "空格")}
          {renderKey(getVirtualKey("Period"))}
          {renderKey(getVirtualKey("Enter"), { flex: 1.7 }, "回车")}
        </div>
      </div>
    );
  }

  function renderFunctions() {
    return (
      <div aria-label="方向与功能键" className="virtual-function-panel">
        <div className="virtual-function-keys" aria-label="F1 到 F12">
          {virtualKeyboardRows[0].slice(1).map((key) => renderKey(key))}
        </div>
        <div className="virtual-function-main">
          <div aria-label="编辑与组合键" className="virtual-editing-keys">
            {renderKey(getVirtualKey("Escape"), { gridRow: 1, gridColumn: 1 })}
            {renderKey(getVirtualKey("Tab"), { gridRow: 1, gridColumn: 2 })}
            {renderKey(getVirtualKey("Backspace"), { gridRow: 1, gridColumn: 3 }, <Delete size={18} />)}
            {renderKey(getVirtualKey("CapsLock"), { gridRow: 2, gridColumn: 1 }, "Caps")}
            {renderKey(getVirtualKey("ShiftLeft"), { gridRow: 2, gridColumn: 2 })}
            {renderKey(getVirtualKey("ControlLeft"), { gridRow: 3, gridColumn: 1 })}
            {renderKey(getVirtualKey("AltLeft"), { gridRow: 3, gridColumn: 2 })}
            {renderKey(getVirtualKey("Enter"), { gridRow: "2 / span 2", gridColumn: 3 }, "↵")}
            {renderKey(getVirtualKey("Space"), { gridRow: 4, gridColumn: "1 / span 3" }, "空格")}
          </div>
          <div aria-label="导航与方向键" className="virtual-navigation-cluster">
            <div className="virtual-navigation-block" aria-label="导航键">
              {["Insert", "Home", "PageUp", "Delete", "End", "PageDown"].map((code) => renderKey(getVirtualKey(code)))}
            </div>
            <div className="virtual-direction-pad" aria-label="方向键">
              {renderKey(getVirtualKey("ArrowUp"), { gridRow: 1, gridColumn: 2 })}
              {renderKey(getVirtualKey("ArrowLeft"), { gridRow: 2, gridColumn: 1 })}
              {renderKey(getVirtualKey("ArrowDown"), { gridRow: 2, gridColumn: 2 })}
              {renderKey(getVirtualKey("ArrowRight"), { gridRow: 2, gridColumn: 3 })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderTextInputs(inputs: VirtualQuickInput[]) {
    return <div className="virtual-quick-input-grid">{inputs.map((input) => (
      <button data-quick-input={input.id} key={input.id} onClick={() => insertQuickInput(input)} onPointerDown={(event) => event.preventDefault()} title={input.text} type="button">
        <strong>{input.label}</strong><code>{input.text}</code>
      </button>
    ))}</div>;
  }

  function renderAiPanel() {
    return (
      <div className="virtual-ai-panel">
        <div aria-label="AI 快捷分类" className="virtual-ai-categories" role="group">
          {([{ id: "shortcuts", label: "组合键" }, { id: "openspec", label: "OpenSpec" }, { id: "common", label: "常用输入" }] as const).map((category) => (
            <button aria-pressed={aiCategory === category.id} className={aiCategory === category.id ? "active" : ""} key={category.id} onClick={() => setAiCategory(category.id)} onPointerDown={(event) => event.preventDefault()} type="button">{category.label}</button>
          ))}
        </div>
        {aiCategory === "shortcuts" ? (
          <>
            <p className="virtual-keyboard-hint">点击即发送到当前终端，具体行为取决于正在使用的工具。</p>
            <div className="virtual-shortcut-grid">{aiVirtualKeyShortcuts.map((shortcut) => (
              <button data-shortcut={shortcut.id} key={shortcut.id} onClick={() => { onKey(shortcut.key, { ...initialVirtualKeyModifiers, ...shortcut.modifiers }); resetModifiers(); setInputNotice(""); }} onPointerDown={(event) => event.preventDefault()} type="button">
                <kbd>{shortcut.label}</kbd><span>{shortcut.description}</span>
              </button>
            ))}</div>
          </>
        ) : (
          <>
            <p className="virtual-keyboard-hint">{aiCategory === "openspec" ? "Codex 技能前缀，填入后可补充需求或变更名，再按回车。" : "点选填入当前终端，可继续编辑，再按回车提交。"}</p>
            {aiCategory === "openspec" ? renderTextInputs(openSpecQuickInputs) : commonQuickInputGroups.map((group) => (
              <div className="virtual-quick-input-group" key={group.label}><h3>{group.label}</h3>{renderTextInputs(group.inputs)}</div>
            ))}
          </>
        )}
        <p aria-live="polite" className="virtual-keyboard-notice" role="status">{inputNotice}</p>
      </div>
    );
  }

  return (
    <section aria-label="虚拟键盘" className={'virtual-keyboard ' + (isMobile ? 'mobile' : 'desktop')} id="terminal-virtual-keyboard">
      <header className="virtual-keyboard-header">
        <strong><Keyboard size={15} />虚拟键盘</strong>
        <span>{([modifiers.ctrl && "Ctrl", modifiers.alt && "Alt", modifiers.shift && "Shift"].filter(Boolean).join(" + ")) || (isMobile ? "按键发送到当前终端" : "组合键：先点 Ctrl / Alt / Shift，再点按键")}</span>
        <button aria-label="收起虚拟键盘" onClick={onClose} onPointerDown={(event) => event.preventDefault()} type="button"><X size={16} /></button>
      </header>
      <div aria-label="键盘面板" className="virtual-keyboard-tabs" role="tablist">
        {([{ id: "typing", label: isMobile ? "字母" : "全键盘" }, { id: "functions", label: "功能键" }, { id: "ai", label: "AI 快捷" }] as const).map((tab) => (
          <button aria-controls={'virtual-keyboard-panel-' + tab.id} aria-selected={panel === tab.id} id={'virtual-keyboard-tab-' + tab.id} key={tab.id} onClick={() => changePanel(tab.id)} onPointerDown={(event) => event.preventDefault()} role="tab" type="button">{tab.label}</button>
        ))}
      </div>
      <div aria-labelledby={'virtual-keyboard-tab-' + panel} className={'virtual-keyboard-content panel-' + panel} id={'virtual-keyboard-panel-' + panel} ref={contentRef} role="tabpanel">
        {panel === "typing" ? (isMobile ? renderMobileTyping() : (
          <div aria-label="完整键盘，可横向滑动" className="virtual-keyboard-scroll" tabIndex={0}>
            <div className="virtual-keyboard-layout">
              <div aria-label="主键盘" className="virtual-keyboard-main">
                {virtualKeyboardRows.map((row, index) => (
                  <div className={'virtual-keyboard-row ' + (index === 0 ? 'function-row' : '')} key={index}>
                    {row.map((key) => renderKey(key, { flex: (key.width ?? 1) + ' 0 0' }))}
                  </div>
                ))}
              </div>
              <div aria-label="导航键" className="virtual-keyboard-navigation">
                {virtualNavigationKeys.map((key) => renderKey(key, { gridRow: key.row, gridColumn: key.column }))}
              </div>
              <div aria-label="数字小键盘" className="virtual-keyboard-numpad">
                {virtualNumpadKeys.map((key) => renderKey(key, {
                  gridRow: key.row + ' / span ' + ("rowSpan" in key ? key.rowSpan : 1),
                  gridColumn: key.column + ' / span ' + ("columnSpan" in key ? key.columnSpan : 1),
                }))}
              </div>
            </div>
          </div>
        )) : panel === "functions" ? renderFunctions() : renderAiPanel()}
      </div>
    </section>
  );
}
