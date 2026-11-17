// Live integration test: exercises the real SDK v3 DLL against a running Everything.
// Skipped automatically when the DLL or Everything's IPC pipe is unavailable, so it
// is safe to run in CI on machines without Everything installed.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveSdk3DllPath, searchEverything } from "../everything.mjs";

function dllAvailable() {
  try {
    resolveSdk3DllPath();
    return true;
  } catch {
    return false;
  }
}

const skip = dllAvailable() ? false : "Everything3_x64.dll not found; set EVERYTHING_SDK3_DLL_PATH";

test("searches the live Everything index", { skip }, async () => {
  const result = await searchEverything({ query: "ext:txt", limit: 3 });
  assert.equal(typeof result.totalMatches, "number");
  assert.ok(result.returned <= 3);
  assert.equal(result.results.length, result.returned);
  for (const item of result.results) {
    assert.equal(typeof item.path, "string");
    assert.ok(item.path.length > 0);
    assert.equal(typeof item.isFolder, "boolean");
  }
});

test("pages through results without repeating entries", { skip }, async () => {
  const first = await searchEverything({ query: "ext:txt", limit: 2, offset: 0 });
  if (!first.hasMore) return; // index too small to page; nothing to compare
  const second = await searchEverything({ query: "ext:txt", limit: 2, offset: first.nextOffset });
  assert.equal(second.offset, first.nextOffset);
  const firstPaths = new Set(first.results.map((item) => item.path));
  for (const item of second.results) {
    assert.ok(!firstPaths.has(item.path), `page 2 repeated ${item.path}`);
  }
});

test("returns an empty page for a query that matches nothing", { skip }, async () => {
  const result = await searchEverything({ query: "zzzz_no_such_file_qqq_12345", limit: 5 });
  assert.equal(result.totalMatches, 0);
  assert.equal(result.returned, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.results, []);
});
