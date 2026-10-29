import test from 'node:test';
import assert from 'node:assert/strict';
import { TerminalProgramScroll, renderedRowMovement } from '../.test-dist/terminalProgramScroll.js';

const frame = start => ['fixed title', ...Array.from({length:20}, (_, i) => 'content line '+(start+i)), 'fixed footer'];

test('requests and unchanged output never advance the grip; confirmed text does', () => {
  const scroll = new TerminalProgramScroll(22);
  scroll.observe(frame(100), 80, 0);
  scroll.request(10);
  assert.equal(scroll.distance, 0);
  scroll.observe(frame(100), 80, 300);
  assert.equal(scroll.distance, 0);
  scroll.observe(frame(97), 80, 600);
  assert.equal(scroll.distance, 3);
  scroll.observe(frame(98), 80, 900);
  assert.equal(scroll.distance, 2);
  scroll.observe(frame(98), 80, 950);
  assert.equal(scroll.distance, 2);
});

test('resize, unrelated output and ambiguous screen replacements do not invent progress', () => {
  const scroll = new TerminalProgramScroll(22);
  scroll.observe(frame(100), 80, 0);
  scroll.observe(frame(97), 80, 100);
  assert.equal(scroll.distance, 0);
  scroll.request(200);
  scroll.observe(frame(94), 40, 300);
  scroll.observe(frame(0), 40, 400);
  assert.equal(scroll.distance, 0);
  assert.equal(renderedRowMovement(['    ', 'border ----', 'border ----'], ['border ----', 'border ----','    ']), null);
});

test('measures actual partial movement with fixed header/footer and ignores single animated lines', () => {
  assert.equal(renderedRowMovement(frame(100), frame(97)), -3);
  assert.equal(renderedRowMovement(frame(97), frame(98)), 1);
  const changed = frame(100); changed[2] = 'spinner working';
  assert.equal(renderedRowMovement(frame(100), changed), null);
});

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

test('edge scrolling expands range without dropping distance or inventing a hard top', () => {
  const scroll = new TerminalProgramScroll(24);
  for (let i = 0; i < 5000; i++) scroll.scroll(-3, 24);
  assert.equal(scroll.distance, 15000);
  assert.ok(scroll.fraction > 0);
  for (let i = 0; i < 5000; i++) scroll.scroll(3, 24);
  assert.equal(scroll.fraction, 1);
});
