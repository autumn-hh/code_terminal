import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeVirtualKey, getVirtualKeyLabel, initialVirtualKeyModifiers,
  virtualKeyboardRows, virtualNavigationKeys, virtualNumpadKeys,
  mobileLetterRows, mobileNumberKeys, mobileCommonSymbolKeys, mobileSymbolPages, mobilePunctuationKeys,
  aiVirtualKeyShortcuts, openSpecQuickInputs, commonQuickInputGroups,
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

test("phone letter layout contains the alphabet without desktop function keys", () => {
  assert.deepEqual(mobileLetterRows.map((row) => row.map((key) => key.value).join("")), ["qwertyuiop", "asdfghjkl", "zxcvbnm"]);
  assert.equal(new Set(mobileLetterRows.flat().map((key) => key.value)).size, 26);
  assert.equal(mobileNumberKeys.map((key) => encodeVirtualKey(key, initialVirtualKeyModifiers)).join(""), "1234567890");
  assert.equal(mobileNumberKeys.map((key) => encodeVirtualKey(key, { ...initialVirtualKeyModifiers, shift: true })).join(""), "!@#$%^&*()");
  for (const value of "/#$-_@:=&" + String.fromCharCode(92)) {
    assert.ok(mobileCommonSymbolKeys.some((key) => key.value === value), `Missing common symbol ${value}`);
  }
  for (const key of [...mobileCommonSymbolKeys, ...mobileSymbolPages.flat(2), ...mobilePunctuationKeys]) {
    assert.equal(encodeVirtualKey(key, initialVirtualKeyModifiers), key.value);
  }
  assert.equal(mobileSymbolPages[0][0].map((key) => key.value).join(""), "1234567890");
});

test("AI shortcuts use the existing terminal encoder", () => {
  const shortcuts = Object.fromEntries(aiVirtualKeyShortcuts.map((shortcut) => [
    shortcut.id, encodeVirtualKey(shortcut.key, { ...initialVirtualKeyModifiers, ...shortcut.modifiers }),
  ]));
  assert.equal(shortcuts.interrupt, "\x03");
  assert.equal(shortcuts.mode, "\x1b[Z");
  assert.equal(shortcuts.newline, "\x1b\r");
  assert.equal(shortcuts.confirm, "\r");
  assert.equal(shortcuts["delete-word"], "\x17");
});

test("quick text preserves OpenSpec prefixes and contains no submission or control characters", () => {
  assert.equal(openSpecQuickInputs.find((input) => input.id === "propose").text, "$openspec-propose ");
  assert.equal(openSpecQuickInputs.find((input) => input.id === "apply").text, "$openspec-apply-change ");
  for (const input of [...openSpecQuickInputs, ...commonQuickInputGroups.flatMap((group) => group.inputs)]) {
    assert.ok(input.text.length > 0);
    assert.doesNotMatch(input.text, /[\x00-\x1f\x7f]/);
  }
});
