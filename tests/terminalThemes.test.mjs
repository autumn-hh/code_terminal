import assert from "node:assert/strict";
import test from "node:test";
import {
  getTerminalPalette,
  normalizeTerminalAppearance,
  terminalThemePresets,
} from "../.test-dist/terminalThemes.js";

test("stored built-in themes adopt the current palette", () => {
  const appearance = normalizeTerminalAppearance({
    preset: "daylight",
    fontSize: 15,
    lineHeight: 1.52,
    background: "#f8fafc",
    foreground: "#1f2933",
    cursor: "#1769aa",
  });

  assert.deepEqual(appearance, {
    preset: "daylight",
    fontSize: 15,
    lineHeight: 1.52,
    background: terminalThemePresets.daylight.background,
    foreground: terminalThemePresets.daylight.foreground,
    cursor: terminalThemePresets.daylight.cursor,
  });
});

test("custom themes keep valid saved colors", () => {
  const appearance = normalizeTerminalAppearance({
    preset: "custom",
    fontSize: 16,
    lineHeight: 1.4,
    background: "#101820",
    foreground: "#e8edf2",
    cursor: "#ff7a45",
  });

  assert.equal(appearance.background, "#101820");
  assert.equal(appearance.foreground, "#e8edf2");
  assert.equal(appearance.cursor, "#ff7a45");
});

test("built-in palettes ignore stale appearance colors", () => {
  const palette = getTerminalPalette({
    preset: "workbench",
    fontSize: 14,
    lineHeight: 1.34,
    background: "#000000",
    foreground: "#ffffff",
    cursor: "#00ff00",
  });

  assert.equal(palette.background, terminalThemePresets.workbench.background);
  assert.equal(palette.foreground, terminalThemePresets.workbench.foreground);
  assert.equal(palette.cursor, terminalThemePresets.workbench.cursor);
});
