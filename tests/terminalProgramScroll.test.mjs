import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalProgramScroll } from '../.test-dist/terminalProgramScroll.js';

test('several pages do not exhaust the track, independent of viewport height', () => {
  for (const rows of [4, 24, 60]) {
    const scroll = new TerminalProgramScroll(rows);
    for (let i = 0; i < 5; i++) scroll.scroll(-rows, rows);
    assert.ok(scroll.fraction > 0.5 && scroll.fraction < 1);
    for (let i = 0; i < 5; i++) scroll.scroll(rows, rows);
    assert.equal(scroll.distance, 0);
    assert.equal(scroll.fraction, 1);
  }
});

test('long scroll distances survive expansion and partial reversal', () => {
  const scroll = new TerminalProgramScroll(24);
  for (let i = 0; i < 100; i++) scroll.scroll(-24, 24);
  assert.equal(scroll.distance, 2400);
  assert.ok(scroll.fraction > 0);
  const range = scroll.range;
  scroll.scroll(24 * 5, 24);
  assert.equal(scroll.distance, 2280);
  assert.ok(scroll.fraction < 0.2);
  assert.equal(scroll.range, range);
  scroll.scroll(2280, 24);
  assert.equal(scroll.fraction, 1);
});

test('resize and fractional wheel events retain logical distance', () => {
  const scroll = new TerminalProgramScroll(24);
  for (let i = 0; i < 400; i++) scroll.scroll(-0.25, 24);
  const position = scroll.fraction;
  scroll.scroll(0, 4);
  assert.equal(scroll.distance, 100);
  assert.equal(scroll.fraction, position);
  for (let i = 0; i < 400; i++) scroll.scroll(0.25, 4);
  assert.equal(scroll.fraction, 1);
});

test('drag uses the same range as wheel and accounts only for delivered steps', () => {
  const scroll = new TerminalProgramScroll(24);
  scroll.scroll(-2400, 24);
  const firstStep = scroll.stepTo(1);
  assert.equal(firstStep, 40);
  scroll.scroll(firstStep, 24);
  assert.equal(scroll.distance, 2360);
  assert.ok(scroll.fraction < 0.2);
  for (let i = 0; i < 100; i++) scroll.scroll(scroll.stepTo(0.5), 24);
  assert.equal(scroll.fraction, 0.5);
});

test('edge scrolling expands range without dropping distance or inventing a hard top', () => {
  const scroll = new TerminalProgramScroll(24);
  for (let i = 0; i < 5000; i++) scroll.scroll(-3, 24);
  assert.equal(scroll.distance, 15000);
  assert.ok(scroll.fraction > 0);
  for (let i = 0; i < 5000; i++) scroll.scroll(3, 24);
  assert.equal(scroll.fraction, 1);
});
