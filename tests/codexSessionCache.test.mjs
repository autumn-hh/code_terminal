import assert from "node:assert/strict";
import test from "node:test";
import { CodexSessionCache, codexSessionProjectKey } from "../.test-dist/codexSessionCache.js";

const project = { id: "project-a", path: "/workspace/alpha" };
const session = (id, title = id, updatedAt = 100) => ({ id, title, cwd: project.path, updatedAt });
const storageKey = (value = project) => "opencode-workbench.codex-sessions.v1:" + codexSessionProjectKey(value);

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value); },
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

test("history persists across cache instances and cached loads do not request it again", async () => {
  const storage = memoryStorage();
  const first = new CodexSessionCache(() => storage);
  let calls = 0;
  const fetchSessions = async () => { calls += 1; return [session("first")]; };
  assert.deepEqual(await first.load(project, fetchSessions), [session("first")]);
  assert.deepEqual(await first.load(project, fetchSessions), [session("first")]);
  const reloaded = new CodexSessionCache(() => storage);
  assert.deepEqual(reloaded.get(project), [session("first")]);
  assert.deepEqual(await reloaded.load(project, fetchSessions), [session("first")]);
  assert.equal(calls, 1);
});

test("identity combines the project ID with a normalized path", () => {
  const windows = { id: "same", path: "C:/Work/Project/" };
  const windowsBackslashes = { id: "same", path: "c:/work//project".replaceAll("/", String.fromCharCode(92)) };
  assert.equal(codexSessionProjectKey(windows), codexSessionProjectKey(windowsBackslashes));
  assert.equal(codexSessionProjectKey(project), codexSessionProjectKey({ ...project, path: "/workspace//alpha/" }));
  assert.notEqual(codexSessionProjectKey(project), codexSessionProjectKey({ ...project, id: "project-b" }));
  assert.notEqual(codexSessionProjectKey(project), codexSessionProjectKey({ ...project, path: "/workspace/beta" }));
  assert.notEqual(codexSessionProjectKey(project), codexSessionProjectKey({ ...project, path: "/workspace/Alpha" }));
  assert.equal(codexSessionProjectKey({ id: "root", path: "/" }), JSON.stringify(["root", "/"]));
});

test("refresh accumulates all loaded IDs, updates matching records, and keeps equal titles distinct", async () => {
  const storage = memoryStorage();
  const cache = new CodexSessionCache(() => storage);
  const initial = Array.from({ length: 30 }, (_, index) => session(`old-${index}`, "same title", 100 - index));
  await cache.load(project, async () => initial);
  const changed = session("old-0", "renamed", 200);
  const recent = Array.from({ length: 11 }, (_, index) => session(`new-${index}`, "same title", 300 - index));
  const result = await cache.load(project, async () => [...recent, changed], true);
  assert.equal(result.length, 41);
  assert.equal(new Set(result.map((entry) => entry.id)).size, 41);
  assert.deepEqual(result.find((entry) => entry.id === "old-0"), changed);
  assert.deepEqual(result.find((entry) => entry.id === "old-29"), initial[29]);
  assert.deepEqual(new CodexSessionCache(() => storage).get(project), result);
  assert.deepEqual(await cache.load(project, async () => [], true), result);
});

test("a successful empty response is cached", async () => {
  const storage = memoryStorage();
  const cache = new CodexSessionCache(() => storage);
  let calls = 0;
  const fetchSessions = async () => { calls += 1; return []; };
  await cache.load(project, fetchSessions);
  await new CodexSessionCache(() => storage).load(project, fetchSessions);
  assert.deepEqual(cache.get(project), []);
  assert.equal(calls, 1);
});

test("a failed refresh preserves memory and persisted history and permits retry", async () => {
  const storage = memoryStorage();
  const cache = new CodexSessionCache(() => storage);
  const initial = [session("old")];
  await cache.load(project, async () => initial);
  const saved = storage.getItem(storageKey());
  await assert.rejects(cache.load(project, async () => { throw new Error("offline"); }, true), /offline/);
  assert.deepEqual(cache.get(project), initial);
  assert.equal(storage.getItem(storageKey()), saved);
  assert.deepEqual(await cache.load(project, async () => [session("new")], true), [session("new"), ...initial]);
});

test("concurrent initial loads and repeated refreshes use one request for the same identity", async () => {
  const cache = new CodexSessionCache(memoryStorage);
  const pending = deferred();
  let calls = 0;
  const fetchSessions = () => { calls += 1; return pending.promise; };
  const first = cache.load(project, fetchSessions);
  const second = cache.load(project, fetchSessions);
  const forced = cache.load(project, fetchSessions, true);
  assert.equal(first, second);
  assert.equal(first, forced);
  await Promise.resolve();
  assert.equal(calls, 1);
  pending.resolve([session("one")]);
  await Promise.all([first, second, forced]);
  const refreshPending = deferred();
  const refresh = cache.load(project, () => refreshPending.promise, true);
  assert.equal(refresh, cache.load(project, fetchSessions, true));
  assert.deepEqual(await cache.load(project, fetchSessions), [session("one")]);
  refreshPending.resolve([session("two")]);
  assert.deepEqual(await refresh, [session("two"), session("one")]);
});

test("a delayed old path request cannot replace history for a project's new path or another ID", async () => {
  const storage = memoryStorage();
  const cache = new CodexSessionCache(() => storage);
  const changedPath = { ...project, path: "/workspace/new-path" };
  const otherProject = { ...project, id: "project-b" };
  const oldPending = deferred();
  const oldRequest = cache.load(project, () => oldPending.promise);
  assert.equal(cache.get(changedPath), undefined);
  await cache.load(changedPath, async () => [session("new-path")]);
  await cache.load(otherProject, async () => [session("other-project")]);
  oldPending.resolve([session("old-path")]);
  await oldRequest;
  assert.deepEqual(cache.get(project), [session("old-path")]);
  assert.deepEqual(cache.get(changedPath), [session("new-path")]);
  assert.deepEqual(cache.get(otherProject), [session("other-project")]);
});

test("invalid storage entries fall back to live history", async () => {
  const invalid = [
    "{broken", "null", "[]",
    JSON.stringify({ version: 2, sessions: [session("wrong-version")] }),
    JSON.stringify({ version: 1, sessions: [{ ...session("missing-title"), title: null }] }),
    JSON.stringify({ version: 1, sessions: [{ ...session("wrong-date"), updatedAt: -1 }] }),
    JSON.stringify({ version: 1, sessions: [session("")] }),
  ];
  for (const raw of invalid) {
    const storage = memoryStorage();
    storage.setItem(storageKey(), raw);
    const cache = new CodexSessionCache(() => storage);
    assert.equal(cache.get(project), undefined);
    assert.deepEqual(await cache.load(project, async () => [session("live")]), [session("live")]);
  }
});

test("unavailable or full localStorage leaves in-memory caching usable", async () => {
  const storageProviders = [
    () => { throw new Error("storage blocked"); },
    () => ({ getItem: () => null, setItem: () => { throw new Error("quota exceeded"); } }),
  ];
  for (const storage of storageProviders) {
    const cache = new CodexSessionCache(storage);
    let calls = 0;
    const fetchSessions = async () => { calls += 1; return [session("memory")]; };
    await cache.load(project, fetchSessions);
    assert.deepEqual(await cache.load(project, fetchSessions), [session("memory")]);
    assert.equal(calls, 1);
  }
});

test("invalid live responses reject without replacing valid cached sessions", async () => {
  const cache = new CodexSessionCache(memoryStorage);
  await cache.load(project, async () => [session("valid")]);
  await assert.rejects(cache.load(project, async () => [{ ...session("invalid"), updatedAt: NaN }], true), /数据格式无效/);
  assert.deepEqual(cache.get(project), [session("valid")]);
  assert.deepEqual(await cache.load(project, async () => [session("retry")], true), [session("retry"), session("valid")]);
});
