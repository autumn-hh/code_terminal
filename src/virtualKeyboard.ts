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

interface CompactVirtualKey {
  id: string;
  code: string;
  label: string;
  modifiers?: Partial<VirtualKeyModifiers>;
}

export const compactVirtualKeys: CompactVirtualKey[] = [
  { id: "ctrl-d", code: "KeyD", label: "Ctrl+D", modifiers: { ctrl: true } },
  { id: "tab", code: "Tab", label: "Tab" },
  { id: "escape", code: "Escape", label: "Esc" },
  { id: "up", code: "ArrowUp", label: "↑" },
  { id: "enter", code: "Enter", label: "Enter" },
  { id: "ctrl-c", code: "KeyC", label: "Ctrl+C", modifiers: { ctrl: true } },
  { id: "alt-enter", code: "Enter", label: "Alt+Enter", modifiers: { alt: true } },
  { id: "left", code: "ArrowLeft", label: "←" },
  { id: "down", code: "ArrowDown", label: "↓" },
  { id: "right", code: "ArrowRight", label: "→" },
];

const allVirtualKeys: VirtualKey[] = [...virtualKeyboardRows.flat(), ...virtualNavigationKeys, ...virtualNumpadKeys];
export function getVirtualKey(code: string): VirtualKey {
  const result = allVirtualKeys.find((key) => key.code === code);
  if (!result) throw new Error(`Unknown virtual key: ${code}`);
  return result;
}

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
