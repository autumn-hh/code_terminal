import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeVirtualKey, getVirtualKeyLabel, initialVirtualKeyModifiers,
  virtualKeyboardRows, virtualNavigationKeys, virtualNumpadKeys,
  compactVirtualKeys, getVirtualKey,
} from "../.test-dist/virtualKeyboard.js";

const keys = [...virtualKeyboardRows.flat(), ...virtualNavigationKeys, ...virtualNumpadKeys];
function press(code, modifiers = {}, modes = {}) {
  const key = keys.find((key) => key.code === code);
  assert.ok(key, `Missing key ${code}`);
  return encodeVirtualKey(key, { ...initialVirtualKeyModifiers, ...modifiers }, modes);
}

test("full keyboard contains 104 unique keys and encodes every terminal key", () => {
  assert.equal(keys.length, 104);
  assert.equal(new Set(keys.map((key) => key.code)).size, 104);
  for (const key of keys) {
    const encoded = encodeVirtualKey(key, initialVirtualKeyModifiers);
    assert.equal(encoded.length > 0, !key.disabled && !key.modifier, key.code);
  }
});

test("Shift and Caps Lock affect letters independently of punctuation and numpad", () => {
  assert.equal(press("KeyA"), "a");
  assert.equal(press("KeyA", { shift: true }), "A");
  assert.equal(press("KeyA", { capsLock: true }), "A");
  assert.equal(press("KeyA", { shift: true, capsLock: true }), "a");
  assert.equal(press("Digit1", { shift: true }), "!");
  assert.equal(press("Backslash"), "\\");
  assert.equal(press("Backslash", { shift: true }), "|");
  assert.equal(press("Numpad1", { shift: true }), "1");
  assert.equal(getVirtualKeyLabel(keys.find((key) => key.code === "Space"), initialVirtualKeyModifiers), "Space");
});

test("terminal shortcuts encode control bytes and Alt prefixes", () => {
  assert.equal(press("KeyC", { ctrl: true }), "\x03");
  assert.equal(press("KeyD", { ctrl: true }), "\x04");
  assert.equal(press("KeyZ", { ctrl: true }), "\x1a");
  assert.equal(press("Space", { ctrl: true }), "\x00");
  assert.equal(press("Backslash", { ctrl: true }), "\x1c");
  assert.equal(press("Slash", { ctrl: true, shift: true }), "\x7f");
  assert.equal(press("KeyB", { alt: true }), "\x1bb");
  assert.equal(press("KeyC", { ctrl: true, alt: true }), "\x1b\x03");
});

test("navigation follows normal and application cursor modes and modifier combinations", () => {
  assert.equal(press("ArrowUp"), "\x1b[A");
  assert.equal(press("ArrowUp", {}, { applicationCursorKeysMode: true }), "\x1bOA");
  assert.equal(press("Home", {}, { applicationCursorKeysMode: true }), "\x1bOH");
  assert.equal(press("ArrowLeft", { ctrl: true }), "\x1b[1;5D");
  assert.equal(press("ArrowRight", { ctrl: true, shift: true }), "\x1b[1;6C");
  assert.equal(press("PageDown", { alt: true }), "\x1b[6;3~");
  assert.equal(press("Delete"), "\x1b[3~");
});

test("function and editing keys produce terminal escape sequences", () => {
  assert.equal(press("F1"), "\x1bOP");
  assert.equal(press("F4", { shift: true }), "\x1b[1;2S");
  assert.equal(press("F5"), "\x1b[15~");
  assert.equal(press("F12", { ctrl: true }), "\x1b[24;5~");
  assert.equal(press("Tab"), "\t");
  assert.equal(press("Tab", { shift: true }), "\x1b[Z");
  assert.equal(press("Enter"), "\r");
  assert.equal(press("Backspace"), "\x7f");
  assert.equal(press("Backspace", { ctrl: true }), "\b");
  assert.equal(press("Escape"), "\x1b");
});

test("numpad follows Num Lock and application keypad mode", () => {
  assert.equal(press("Numpad0"), "0");
  assert.equal(press("Numpad0", { numLock: false }), "\x1b[2~");
  assert.equal(press("Numpad2", { numLock: false }), "\x1b[B");
  assert.equal(press("NumpadDecimal", { numLock: false }), "\x1b[3~");
  assert.equal(press("Numpad7", {}, { applicationKeypadMode: true }), "\x1bOw");
  assert.equal(press("NumpadEnter", {}, { applicationKeypadMode: true }), "\x1bOM");
  assert.equal(press("NumpadEnter"), "\r");
});

test("compact keyboard sends each shortcut once with its own modifiers", () => {
  const expected = ["\x04", "\t", "\x1b", "\x1b[A", "\r", "\x03", "\x1b\r", "\x1b[D", "\x1b[B", "\x1b[C"];
  assert.equal(new Set(compactVirtualKeys.map((key) => key.id)).size, 10);
  assert.deepEqual(compactVirtualKeys.map(({ code, modifiers }) =>
    encodeVirtualKey(getVirtualKey(code), { ...initialVirtualKeyModifiers, ...modifiers })), expected);
  for (const { code, modifiers } of compactVirtualKeys.filter((key) => key.code.startsWith("Arrow"))) {
    assert.equal(encodeVirtualKey(getVirtualKey(code), { ...initialVirtualKeyModifiers, ...modifiers }, { applicationCursorKeysMode: true }), `\x1bO${{ ArrowUp: "A", ArrowDown: "B", ArrowLeft: "D", ArrowRight: "C" }[code]}`);
  }
});
