import assert from "node:assert/strict";
import test from "node:test";
import { TerminalCursorController } from "../.test-dist/terminalCursorController.js";

function createHarness() {
  let nextTimer = 0;
  const callbacks = new Map();
  const changes = [];
  const controller = new TerminalCursorController(
    (suppressed) => changes.push(suppressed),
    (callback) => {
      nextTimer += 1;
      callbacks.set(nextTimer, callback);
      return nextTimer;
    },
    (timer) => callbacks.delete(timer),
  );
  return { callbacks, changes, controller };
}

test("stale output reveal cannot override newer suppression", () => {
  const { callbacks, changes, controller } = createHarness();
  controller.suppress();
  controller.revealAfter(100, () => true);
  const staleReveal = callbacks.values().next().value;

  controller.suppress();
  staleReveal();

  assert.equal(controller.isSuppressed(), true);
  assert.deepEqual(changes, [true]);
});

test("input reveal cancels a pending output reveal", () => {
  const { callbacks, changes, controller } = createHarness();
  controller.suppress();
  controller.revealAfter(100, () => true);
  const staleReveal = callbacks.values().next().value;

  controller.revealNow();
  staleReveal();

  assert.equal(controller.isSuppressed(), false);
  assert.deepEqual(changes, [true, false]);
});

test("latest reveal waits until the output queue is idle", () => {
  const { callbacks, changes, controller } = createHarness();
  let idle = false;
  controller.suppress();
  controller.revealAfter(100, () => idle);

  Array.from(callbacks.values()).at(-1)();
  assert.equal(controller.isSuppressed(), true);

  idle = true;
  controller.revealAfter(100, () => idle);
  Array.from(callbacks.values()).at(-1)();
  assert.equal(controller.isSuppressed(), false);
  assert.deepEqual(changes, [true, false]);
});
