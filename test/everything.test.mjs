import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  createSdk3Bindings,
  resolveSdk3DllPath,
  searchEverything,
  searchWithSdk3,
  validateSearchInput,
} from "../everything.mjs";

function makeSdk(overrides = {}) {
  const calls = [];
  const resultPaths = ["C:\\Docs\\notes.txt", "C:\\Docs\\Archive"];
  const sdk = {
    calls,
    connect(instanceName) {
      calls.push(["connect", instanceName]);
      return instanceName === null ? 10n : 0n;
    },
    getLastError: () => 0xe0000002,
    destroyClient: (client) => calls.push(["destroyClient", client]),
    createSearchState: () => 20n,
    destroySearchState: (state) => calls.push(["destroySearchState", state]),
    setSearchText: (state, query) => calls.push(["setSearchText", state, query]) || 1,
    addSearchPropertyRequest: (state, propertyId) =>
      calls.push(["addSearchPropertyRequest", state, propertyId]) || 1,
    setSearchViewportOffset: (state, offset) => (calls.push(["setOffset", state, offset]), 0),
    setSearchViewportCount: (state, count) => (calls.push(["setCount", state, count]), 0),
    search: (client, state) => (calls.push(["search", client, state]), 30n),
    destroyResultList: (list) => calls.push(["destroyResultList", list]),
    getResultListCount: () => 9n,
    getResultListViewportCount: () => 2n,
    isFolderResult: (_list, index) => Number(index) === 1,
    getResultFullPathName: (_list, index, buffer) => {
      const value = resultPaths[Number(index)];
      Buffer.from(value, "utf16le").copy(buffer);
      return value.length;
    },
    getResultSize: (_list, index) =>
      Number(index) === 0 ? 123n : 0xffffffffffffffffn,
    getResultDateModified: (_list, index) =>
      Number(index) === 0 ? 132223104000000000n : 0xffffffffffffffffn,
    ...overrides,
  };
  return sdk;
}

test("validates query and applies the default limit and offset", () => {
  assert.deepEqual(validateSearchInput({ query: "  report ext:pdf  " }), {
    query: "report ext:pdf",
    limit: 25,
    offset: 0,
  });
});

test("rejects empty queries, unsupported keys, and invalid paging", () => {
  assert.throws(() => validateSearchInput({ query: "  " }), /must not be empty/);
  assert.throws(() => validateSearchInput({ query: "test", path: "C:\\" }), /Unsupported argument/);
  assert.throws(() => validateSearchInput({ query: "test", limit: 101 }), /1 to 100/);
  assert.throws(() => validateSearchInput({ query: "test", limit: 1.5 }), /1 to 100/);
  assert.throws(() => validateSearchInput({ query: "test", offset: -1 }), /offset must be/);
});

test("resolves the SDK v3 x64 DLL from the configured path", () => {
  const expected = path.resolve("C:\\SDK\\Everything3_x64.dll");
  assert.equal(
    resolveSdk3DllPath({
      env: { EVERYTHING_SDK3_DLL_PATH: "C:\\SDK\\Everything3_x64.dll" },
      exists: (candidate) => candidate === expected,
    }),
    expected,
  );
});

test("explains how to install the missing SDK v3 DLL", () => {
  assert.throws(
    () => resolveSdk3DllPath({ env: {}, exists: () => false }),
    /Everything3_x64\.dll.*SDK v3/s,
  );
});

test("binds the official SDK v3 exports with their Windows ABI", () => {
  const prototypes = [];
  let loadedPath;
  const bindings = createSdk3Bindings(
    {
      load: (dllPath) => {
        loadedPath = dllPath;
        return { func: (prototype) => (prototypes.push(prototype), () => 1) };
      },
    },
    "C:\\SDK\\Everything3_x64.dll",
  );
  assert.equal(loadedPath, "C:\\SDK\\Everything3_x64.dll");
  assert.equal(typeof bindings.connect, "function");
  assert.ok(prototypes.some((prototype) => prototype.includes("Everything3_ConnectW")));
  assert.ok(prototypes.some((prototype) => prototype.includes("Everything3_Search")));
  assert.ok(prototypes.every((prototype) => prototype.includes("__stdcall")));
});

test("searches through SDK v3 and returns paged metadata", () => {
  const sdk = makeSdk();
  const result = searchWithSdk3(sdk, { query: "notes ext:txt", limit: 2, offset: 4 });
  assert.deepEqual(result, {
    query: "notes ext:txt",
    offset: 4,
    limit: 2,
    totalMatches: 9,
    returned: 2,
    hasMore: true,
    nextOffset: 6,
    results: [
      {
        path: "C:\\Docs\\notes.txt",
        isFolder: false,
        sizeBytes: 123,
        dateModifiedUtc: "2020-01-01T00:00:00.000Z",
      },
      {
        path: "C:\\Docs\\Archive",
        isFolder: true,
        sizeBytes: null,
        dateModifiedUtc: null,
      },
    ],
  });
  assert.ok(sdk.calls.some(([name, , offset]) => name === "setOffset" && offset === 4));
  assert.ok(sdk.calls.some(([name, , count]) => name === "setCount" && count === 2));
  assert.deepEqual(
    sdk.calls.filter(([name]) => name === "addSearchPropertyRequest").map(([, , id]) => id),
    [240, 2, 5],
  );
  assert.ok(sdk.calls.some(([name]) => name === "destroyResultList"));
  assert.ok(sdk.calls.some(([name]) => name === "destroySearchState"));
  assert.ok(sdk.calls.some(([name]) => name === "destroyClient"));
});

test("falls back to the Everything 1.5a instance and reports SDK errors", () => {
  const calls = [];
  const sdk = makeSdk({
    connect: (instanceName) => {
      calls.push(instanceName);
      return instanceName === "1.5a" ? 10n : 0n;
    },
    setSearchText: () => 0,
  });
  assert.throws(
    () => searchWithSdk3(sdk, { query: "foo", limit: 5, offset: 0 }),
    /Could not set the search query.*E0000002/,
  );
  assert.deepEqual(calls, [null, "1.5a"]);
  assert.ok(sdk.calls.some(([name]) => name === "destroySearchState"));
  assert.ok(sdk.calls.some(([name]) => name === "destroyClient"));
});

test("searchEverything validates input before calling the SDK adapter", async () => {
  const result = await searchEverything(
    { query: "  invoice  ", limit: 3, offset: 2 },
    { sdk: makeSdk() },
  );
  assert.equal(result.query, "invoice");
  assert.equal(result.offset, 2);
  assert.equal(result.limit, 3);
});

test("reports the last page without a next offset", () => {
  const sdk = makeSdk({ getResultListCount: () => 6n });
  const result = searchWithSdk3(sdk, { query: "notes", limit: 2, offset: 4 });
  assert.equal(result.totalMatches, 6);
  assert.equal(result.returned, 2);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextOffset, null);
});

test("reports no next offset when the page is empty", () => {
  const sdk = makeSdk({ getResultListCount: () => 6n, getResultListViewportCount: () => 0n });
  const result = searchWithSdk3(sdk, { query: "notes", limit: 5, offset: 100 });
  assert.equal(result.returned, 0);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextOffset, null);
  assert.deepEqual(result.results, []);
});

test("keeps counts numeric when the SDK reports an oversized total", () => {
  const sdk = makeSdk({ getResultListCount: () => 2n ** 60n });
  const result = searchWithSdk3(sdk, { query: "notes", limit: 1, offset: 0 });
  assert.equal(typeof result.totalMatches, "number");
  assert.equal(result.totalMatches, Number.MAX_SAFE_INTEGER);
});
