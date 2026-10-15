export interface VirtualKeyModifiers {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
  capsLock: boolean;
  numLock: boolean;
}

export interface VirtualKey {
  code: string;
  label: string;
  value?: string;
  shifted?: string;
  width?: number;
  modifier?: keyof VirtualKeyModifiers;
  disabled?: boolean;
}

export const initialVirtualKeyModifiers: VirtualKeyModifiers = {
  shift: false, ctrl: false, alt: false, meta: false, capsLock: false, numLock: true,
};

const key = (code: string, label: string, width = 1): VirtualKey => ({ code, label, width });
const character = (value: string, shifted?: string, code = value): VirtualKey => ({
  code, label: value, value, shifted,
});
const letters = (text: string) => [...text].map((value) => character(value, value.toUpperCase(), `Key${value.toUpperCase()}`));
const modifier = (code: string, label: string, name: keyof VirtualKeyModifiers, width: number): VirtualKey => ({
  ...key(code, label, width), modifier: name,
});

export const virtualKeyboardRows: VirtualKey[][] = [
  [key('Escape', 'Esc'), ...Array.from({ length: 12 }, (_, index) => key(`F${index + 1}`, `F${index + 1}`))],
  [
    character('`', '~', 'Backquote'),
    ...[...'1234567890'].map((value, index) => character(value, '!@#$%^&*()'[index], `Digit${value}`)),
    character('-', '_', 'Minus'), character('=', '+', 'Equal'), key('Backspace', 'Backspace', 2),
  ],
  [
    key('Tab', 'Tab', 1.5), ...letters('qwertyuiop'), character('[', '{', 'BracketLeft'),
    character(']', '}', 'BracketRight'), { ...character('\\', '|', 'Backslash'), width: 1.5 },
  ],
  [
    modifier('CapsLock', 'Caps Lock', 'capsLock', 1.75), ...letters('asdfghjkl'),
    character(';', ':', 'Semicolon'), character(String.fromCharCode(39), String.fromCharCode(34), 'Quote'), key('Enter', 'Enter', 2.25),
  ],
  [
    modifier('ShiftLeft', 'Shift', 'shift', 2.25), ...letters('zxcvbnm'),
    character(',', '<', 'Comma'), character('.', '>', 'Period'), character('/', '?', 'Slash'),
    modifier('ShiftRight', 'Shift', 'shift', 2.75),
  ],
  [
    modifier('ControlLeft', 'Ctrl', 'ctrl', 1.25), modifier('MetaLeft', 'Win', 'meta', 1.25),
    modifier('AltLeft', 'Alt', 'alt', 1.25), { ...character(' ', undefined, 'Space'), label: 'Space', width: 6.25 },
    modifier('AltRight', 'Alt', 'alt', 1.25), modifier('MetaRight', 'Win', 'meta', 1.25),
    { ...key('ContextMenu', 'Menu', 1.25), disabled: true }, modifier('ControlRight', 'Ctrl', 'ctrl', 1.25),
  ],
];

export const virtualNavigationKeys = [
  { ...key('PrintScreen', 'PrtSc'), row: 1, column: 1, disabled: true },
  { ...key('ScrollLock', 'ScrLk'), row: 1, column: 2, disabled: true },
  { ...key('Pause', 'Pause'), row: 1, column: 3, disabled: true },
  { ...key('Insert', 'Ins'), row: 2, column: 1 },
  { ...key('Home', 'Home'), row: 2, column: 2 },
  { ...key('PageUp', 'PgUp'), row: 2, column: 3 },
  { ...key('Delete', 'Del'), row: 3, column: 1 },
  { ...key('End', 'End'), row: 3, column: 2 },
  { ...key('PageDown', 'PgDn'), row: 3, column: 3 },
  { ...key('ArrowUp', '↑'), row: 5, column: 2 },
  { ...key('ArrowLeft', '←'), row: 6, column: 1 },
  { ...key('ArrowDown', '↓'), row: 6, column: 2 },
  { ...key('ArrowRight', '→'), row: 6, column: 3 },
];

export const virtualNumpadKeys = [
  { ...modifier('NumLock', 'Num', 'numLock', 1), row: 2, column: 1 },
  { ...character('/', undefined, 'NumpadDivide'), row: 2, column: 2 },
  { ...character('*', undefined, 'NumpadMultiply'), row: 2, column: 3 },
  { ...character('-', undefined, 'NumpadSubtract'), row: 2, column: 4 },
  ...[7, 8, 9, 4, 5, 6, 1, 2, 3].map((value, index) => ({
    ...character(String(value), undefined, `Numpad${value}`), row: 3 + Math.floor(index / 3), column: 1 + index % 3,
  })),
  { ...character('+', undefined, 'NumpadAdd'), row: 3, column: 4, rowSpan: 2 },
  { ...key('NumpadEnter', 'Enter'), row: 5, column: 4, rowSpan: 2 },
  { ...character('0', undefined, 'Numpad0'), row: 6, column: 1, columnSpan: 2 },
  { ...character('.', undefined, 'NumpadDecimal'), row: 6, column: 3 },
];

// Match the app's narrow-screen layout and phone landscape orientation.
export const mobileVirtualKeyboardQuery =
  "(max-width: 720px) and (pointer: coarse), (max-width: 480px), (max-height: 480px) and (pointer: coarse)";

export const mobileLetterRows = [letters("qwertyuiop"), letters("asdfghjkl"), letters("zxcvbnm")];
export const mobileNumberKeys = virtualKeyboardRows[1].slice(1, 11);
export const mobileCommonSymbolKeys = [..."/#$-_@:=&" + String.fromCharCode(92)]
  .map((value) => character(value, undefined, `CommonSymbol${value}`));
export const mobileSymbolPages: VirtualKey[][][] = [
  ["1234567890", "-/:;()$&@" + String.fromCharCode(34)],
  ["[]{}#%^*+=", "_" + String.fromCharCode(92) + "|~<>€£¥•"],
].map((page) => page.map((row) => [...row].map((value) => character(value, undefined, `Symbol${value}`))));
export const mobilePunctuationKeys = [...".,?!" + String.fromCharCode(39)]
  .map((value) => character(value, undefined, `Punctuation${value}`));

const allVirtualKeys: VirtualKey[] = [...virtualKeyboardRows.flat(), ...virtualNavigationKeys, ...virtualNumpadKeys];
export function getVirtualKey(code: string): VirtualKey {
  const result = allVirtualKeys.find((key) => key.code === code);
  if (!result) throw new Error(`Unknown virtual key: ${code}`);
  return result;
}

export interface VirtualKeyShortcut {
  id: string;
  label: string;
  description: string;
  key: VirtualKey;
  modifiers?: Partial<VirtualKeyModifiers>;
}

export const aiVirtualKeyShortcuts: VirtualKeyShortcut[] = [
  { id: "interrupt", label: "Ctrl+C", description: "中断当前操作", key: getVirtualKey("KeyC"), modifiers: { ctrl: true } },
  { id: "escape", label: "Esc", description: "取消 / 关闭菜单", key: getVirtualKey("Escape") },
  { id: "confirm", label: "Enter", description: "确认 / 提交输入", key: getVirtualKey("Enter") },
  { id: "complete", label: "Tab", description: "补全 / 下一项", key: getVirtualKey("Tab") },
  { id: "mode", label: "Shift+Tab", description: "切换模式（视工具）", key: getVirtualKey("Tab"), modifiers: { shift: true } },
  { id: "newline", label: "Alt+Enter", description: "换行（视工具）", key: getVirtualKey("Enter"), modifiers: { alt: true } },
  { id: "clear", label: "Ctrl+L", description: "清屏 / 重绘", key: getVirtualKey("KeyL"), modifiers: { ctrl: true } },
  { id: "line-start", label: "Ctrl+A", description: "移到行首", key: getVirtualKey("KeyA"), modifiers: { ctrl: true } },
  { id: "line-end", label: "Ctrl+E", description: "移到行尾", key: getVirtualKey("KeyE"), modifiers: { ctrl: true } },
  { id: "clear-line", label: "Ctrl+U", description: "删除到行首", key: getVirtualKey("KeyU"), modifiers: { ctrl: true } },
  { id: "delete-word", label: "Ctrl+W", description: "删除前一个词", key: getVirtualKey("KeyW"), modifiers: { ctrl: true } },
  { id: "previous", label: "↑", description: "上一条历史输入", key: getVirtualKey("ArrowUp") },
];

export interface VirtualQuickInput {
  id: string;
  label: string;
  text: string;
}

export const openSpecQuickInputs: VirtualQuickInput[] = [
  { id: "explore", label: "探索需求", text: "$openspec-explore " },
  { id: "propose", label: "创建提案", text: "$openspec-propose " },
  { id: "apply", label: "实施变更", text: "$openspec-apply-change " },
  { id: "update", label: "更新计划", text: "$openspec-update-change " },
  { id: "sync", label: "同步规格", text: "$openspec-sync-specs " },
  { id: "archive", label: "归档变更", text: "$openspec-archive-change " },
];

export const commonQuickInputGroups: { label: string; inputs: VirtualQuickInput[] }[] = [
  { label: "常用提示", inputs: [
    { id: "continue", label: "继续执行", text: "继续完成剩余任务。" },
    { id: "chinese", label: "中文回答", text: "请使用中文回答。" },
    { id: "analyze", label: "先分析问题", text: "请先分析问题原因，并给出修改方案。" },
    { id: "review", label: "检查改动", text: "请检查当前改动，重点关注潜在 bug 和回归风险。" },
    { id: "test", label: "运行测试", text: "请运行相关检查和测试，并说明结果。" },
    { id: "explain", label: "解释代码", text: "请解释这段代码的作用和执行流程。" },
  ] },
  { label: "终端命令", inputs: [
    { id: "codex", label: "启动 Codex", text: "codex" },
    { id: "resume", label: "恢复会话", text: "codex resume" },
    { id: "git-status", label: "Git 状态", text: "git status" },
    { id: "git-diff", label: "Git 差异", text: "git diff" },
    { id: "frontend-test", label: "前端测试", text: "npm run test:frontend" },
    { id: "frontend-build", label: "前端构建", text: "npm run build:frontend" },
  ] },
];

const cursorKeys: Record<string, string> = {
  ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F',
};
const tildeKeys: Record<string, number> = {
  Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24,
};
const numpadNavigation: Record<string, string> = {
  Numpad0: 'Insert', Numpad1: 'End', Numpad2: 'ArrowDown', Numpad3: 'PageDown',
  Numpad4: 'ArrowLeft', Numpad5: 'Clear', Numpad6: 'ArrowRight', Numpad7: 'Home',
  Numpad8: 'ArrowUp', Numpad9: 'PageUp', NumpadDecimal: 'Delete',
};
const applicationNumpad: Record<string, string> = {
  Numpad0: 'p', Numpad1: 'q', Numpad2: 'r', Numpad3: 's', Numpad4: 't', Numpad5: 'u',
  Numpad6: 'v', Numpad7: 'w', Numpad8: 'x', Numpad9: 'y', NumpadDecimal: 'n',
  NumpadDivide: 'o', NumpadMultiply: 'j', NumpadSubtract: 'm', NumpadAdd: 'k', NumpadEnter: 'M',
};

export function getVirtualKeyLabel(key: VirtualKey, modifiers: VirtualKeyModifiers) {
  if (!key.value || key.value === ' ' || key.code.startsWith('Numpad')) return key.label;
  if (/^[a-z]$/.test(key.value)) return modifiers.shift !== modifiers.capsLock ? key.value.toUpperCase() : key.value;
  return modifiers.shift && key.shifted ? key.shifted : key.value;
}

/** Encode terminal input, respecting the current TUI cursor/keypad modes. */
export function encodeVirtualKey(
  key: VirtualKey,
  modifiers: VirtualKeyModifiers,
  modes: { applicationCursorKeysMode?: boolean; applicationKeypadMode?: boolean } = {},
): string {
  if (key.disabled || key.modifier) return '';
  const modifierBits = Number(modifiers.shift) + Number(modifiers.alt) * 2 + Number(modifiers.ctrl) * 4 + Number(modifiers.meta) * 8;
  const modifierParameter = modifierBits + 1;
  const prefix = (value: string) => modifiers.alt || modifiers.meta ? `\x1b${value}` : value;
  let code = key.code;
  if (code.startsWith('Numpad')) {
    if (modes.applicationKeypadMode && !modifierBits && applicationNumpad[code]) return `\x1bO${applicationNumpad[code]}`;
    if (!modifiers.numLock && numpadNavigation[code]) code = numpadNavigation[code];
  }
  if (cursorKeys[code]) {
    const suffix = cursorKeys[code];
    return modifierBits ? `\x1b[1;${modifierParameter}${suffix}` : `\x1b${modes.applicationCursorKeysMode ? 'O' : '['}${suffix}`;
  }
  if (tildeKeys[code]) return `\x1b[${tildeKeys[code]}${modifierBits ? `;${modifierParameter}` : ''}~`;
  if (/^F[1-4]$/.test(code)) {
    const suffix = 'PQRS'[Number(code.slice(1)) - 1];
    return modifierBits ? `\x1b[1;${modifierParameter}${suffix}` : `\x1bO${suffix}`;
  }
  switch (code) {
    case 'Escape': return prefix('\x1b');
    case 'Backspace': return prefix(modifiers.ctrl ? '\b' : '\x7f');
    case 'Tab': return modifiers.shift ? '\x1b[Z' : prefix('\t');
    case 'Enter':
    case 'NumpadEnter': return prefix('\r');
    case 'Clear': return modifierBits ? `\x1b[1;${modifierParameter}E` : '\x1b[E';
  }
  if (key.value === undefined) return '';
  let value = key.value === ' ' ? ' ' : getVirtualKeyLabel(key, modifiers);
  if (modifiers.ctrl) {
    const control = value.toUpperCase();
    if (/^[A-Z]$/.test(control)) value = String.fromCharCode(control.charCodeAt(0) - 64);
    else if (' @2'.includes(control)) value = '\x00';
    else if (control === '[' || control === '3') value = '\x1b';
    else if (control === '\\' || control === '4') value = '\x1c';
    else if (control === ']' || control === '5') value = '\x1d';
    else if (control === '^' || control === '6') value = '\x1e';
    else if (control === '_' || control === '-' || control === '7') value = '\x1f';
    else if (control === '?' || control === '8') value = '\x7f';
    else return '';
  }
  return prefix(value);
}
