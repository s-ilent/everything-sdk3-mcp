import { statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_RESULT_LIMIT = 25;
export const MAX_RESULT_LIMIT = 100;
export const MAX_RESULT_OFFSET = 1_000_000_000;
export const FULL_PATH_BUFFER_CHARS = 32_768;

// SDK v3 only returns properties the search state explicitly requests. FULL_PATH is
// the implicit fallback only while no property is requested, so asking for size and
// date modified means asking for the path as well.
const PROPERTY_ID_SIZE = 2;
const PROPERTY_ID_DATE_MODIFIED = 5;
const PROPERTY_ID_FULL_PATH = 240;

const SDK_ERRORS = new Map([
  [0xe0000001, "Everything SDK ran out of memory."],
  [0xe0000002, "Everything SDK v3 could not see its IPC pipe from this process (0xE0000002); check the caller's Windows session and IPC visibility."],
  [0xe0000003, "The Everything SDK IPC connection was disconnected."],
  [0xe0000004, "The Everything SDK rejected a parameter."],
  [0xe0000005, "Everything received an invalid SDK request."],
  [0xe0000006, "The Everything request was cancelled."],
  [0xe0000008, "Everything reported a server-side error."],
  [0xe000000a, "Everything returned an invalid SDK response."],
  [0xe000000b, "The Everything SDK output buffer was too small."],
  [0xe000000c, "Everything is shutting down."],
  [0xe000000d, "The Everything SDK property value has an unexpected type."],
]);

const PROJECT_DIR = path.dirname(fileURLToPath(import.meta.url));

function isFile(filePath) {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function resolveSdk3DllPath({ env = process.env, exists = isFile } = {}) {
  const configuredPath = env.EVERYTHING_SDK3_DLL_PATH;
  if (configuredPath) {
    const resolved = path.resolve(configuredPath);
    if (exists(resolved)) return resolved;
    throw new Error(`EVERYTHING_SDK3_DLL_PATH does not point to a file: ${resolved}`);
  }

  const candidates = [
    path.join(PROJECT_DIR, "vendor", "Everything3_x64.dll"),
    path.join(PROJECT_DIR, "vendor", "everything-sdk3", "Everything3_x64.dll"),
  ];
  for (const candidate of candidates) {
    if (exists(candidate)) return path.resolve(candidate);
  }

  throw new Error(
    "Could not find Everything3_x64.dll. Download the Everything 1.5 SDK v3, extract its x64 DLL, " +
      "and set EVERYTHING_SDK3_DLL_PATH (or place the DLL in vendor). Official SDK: " +
      "https://github.com/voidtools/everything_sdk3/releases",
  );
}

export function validateSearchInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Arguments must be an object containing query and optional limit/offset.");
  }
  const unexpected = Object.keys(input).filter((key) => !["query", "limit", "offset"].includes(key));
  if (unexpected.length > 0) {
    throw new Error(`Unsupported argument(s): ${unexpected.join(", ")}.`);
  }
  if (typeof input.query !== "string") {
    throw new Error("query must be a string using Everything search syntax.");
  }

  const query = input.query.trim();
  if (!query) throw new Error("query must not be empty; provide an Everything search query.");
  if (query.length > 4096) throw new Error("query must be 4096 characters or fewer.");
  if (query.includes("\0")) throw new Error("query must not contain a null character.");

  const limit = input.limit ?? DEFAULT_RESULT_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_RESULT_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_RESULT_LIMIT}.`);
  }
  const offset = input.offset ?? 0;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > MAX_RESULT_OFFSET) {
    throw new Error(`offset must be an integer from 0 to ${MAX_RESULT_OFFSET}.`);
  }
  return { query, limit, offset };
}

/** Bind the small, read-only subset of Everything SDK v3 used by this MCP. */
export function createSdk3Bindings(koffi, dllPath) {
  const library = koffi.load(dllPath);
  const func = (prototype) => library.func(prototype);

  return {
    connect: func("void * __stdcall Everything3_ConnectW(const wchar_t *instance_name)"),
    getLastError: func("uint32_t __stdcall Everything3_GetLastError(void)"),
    destroyClient: func("int32_t __stdcall Everything3_DestroyClient(void *client)"),
    createSearchState: func("void * __stdcall Everything3_CreateSearchState(void)"),
    destroySearchState: func("int32_t __stdcall Everything3_DestroySearchState(void *search_state)"),
    setSearchText: func(
      "int32_t __stdcall Everything3_SetSearchTextW(void *search_state, const wchar_t *search)",
    ),
    addSearchPropertyRequest: func(
      "int32_t __stdcall Everything3_AddSearchPropertyRequest(void *search_state, uint32_t property_id)",
    ),
    setSearchViewportOffset: func(
      "int32_t __stdcall Everything3_SetSearchViewportOffset(void *search_state, size_t offset)",
    ),
    setSearchViewportCount: func(
      "int32_t __stdcall Everything3_SetSearchViewportCount(void *search_state, size_t count)",
    ),
    search: func("void * __stdcall Everything3_Search(void *client, void *search_state)"),
    destroyResultList: func("int32_t __stdcall Everything3_DestroyResultList(void *result_list)"),
    getResultListCount: func("size_t __stdcall Everything3_GetResultListCount(const void *result_list)"),
    getResultListViewportCount: func(
      "size_t __stdcall Everything3_GetResultListViewportCount(const void *result_list)",
    ),
    isFolderResult: func(
      "int32_t __stdcall Everything3_IsFolderResult(const void *result_list, size_t result_index)",
    ),
    getResultFullPathName: func(
      "size_t __stdcall Everything3_GetResultFullPathNameW(const void *result_list, size_t result_index, _Out_ wchar_t *out_wbuf, size_t wbuf_size_in_wchars)",
    ),
    getResultSize: func(
      "uint64_t __stdcall Everything3_GetResultSize(const void *result_list, size_t result_index)",
    ),
    getResultDateModified: func(
      "uint64_t __stdcall Everything3_GetResultDateModified(const void *result_list, size_t result_index)",
    ),
  };
}

async function loadSdk3(dllPath) {
  if (process.platform !== "win32") {
    throw new Error("Everything SDK v3 is Windows-only.");
  }
  if (process.arch !== "x64") {
    throw new Error("This MVP requires 64-bit Node.js and Everything3_x64.dll.");
  }

  let koffiModule;
  try {
    koffiModule = await import("koffi");
  } catch (error) {
    throw new Error(`Koffi is not installed. Run npm install in the MCP folder. (${error.message})`);
  }
  return createSdk3Bindings(koffiModule.default ?? koffiModule, dllPath);
}

function isNullPointer(pointer) {
  return pointer === null || pointer === undefined || pointer === 0 || pointer === 0n;
}

function sdkFailure(sdk, operation) {
  const code = Number(sdk.getLastError()) >>> 0;
  const hex = `0x${code.toString(16).toUpperCase().padStart(8, "0")}`;
  return new Error(`${operation}: ${SDK_ERRORS.get(code) ?? "Unknown Everything SDK v3 error."} (${hex})`);
}

function requireSuccess(sdk, succeeded, operation) {
  if (!succeeded) throw sdkFailure(sdk, operation);
}

// Counts and sizes are declared as JSON integers, so they must stay numbers. An
// index cannot hold more than 2^53 items, but clamp rather than emit a string that
// would violate the output schema.
function jsonSafeUnsigned(value) {
  const integer = typeof value === "bigint" ? value : BigInt(value);
  return integer <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(integer) : Number.MAX_SAFE_INTEGER;
}

function sizeToJson(value) {
  const size = typeof value === "bigint" ? value : BigInt(value);
  if (size === 0xffffffffffffffffn) return null;
  return jsonSafeUnsigned(size);
}

function fileTimeToIso(value) {
  const fileTime = typeof value === "bigint" ? value : BigInt(value);
  if (fileTime === 0n || fileTime === 0xffffffffffffffffn) return null;
  const unixMilliseconds = Number(fileTime / 10_000n - 11_644_473_600_000n);
  const date = new Date(unixMilliseconds);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function decodeWideStringBuffer(buffer) {
  let end = buffer.length;
  for (let offset = 0; offset + 1 < buffer.length; offset += 2) {
    if (buffer[offset] === 0 && buffer[offset + 1] === 0) {
      end = offset;
      break;
    }
  }
  return buffer.toString("utf16le", 0, end);
}

function readFullPath(sdk, resultList, index) {
  const buffer = Buffer.alloc(FULL_PATH_BUFFER_CHARS * 2);
  const charsWritten = Number(sdk.getResultFullPathName(resultList, index, buffer, FULL_PATH_BUFFER_CHARS));
  if (charsWritten <= 0) throw sdkFailure(sdk, `Could not read result path at index ${index}`);
  if (charsWritten >= FULL_PATH_BUFFER_CHARS) {
    throw new Error(`Result path at index ${index} exceeds the SDK path buffer limit.`);
  }
  return decodeWideStringBuffer(buffer);
}

function safeDestroy(destroy, pointer) {
  if (!isNullPointer(pointer)) {
    try {
      destroy(pointer);
    } catch {
      // Preserve the original query result/error if cleanup fails during teardown.
    }
  }
}

export function searchWithSdk3(sdk, { query, limit, offset }) {
  let client = sdk.connect(null);
  if (isNullPointer(client)) client = sdk.connect("1.5a");
  if (isNullPointer(client)) throw sdkFailure(sdk, "Could not connect to Everything 1.5");

  let searchState = null;
  let resultList = null;
  try {
    searchState = sdk.createSearchState();
    if (isNullPointer(searchState)) throw sdkFailure(sdk, "Could not create a search state");

    requireSuccess(sdk, sdk.setSearchText(searchState, query), "Could not set the search query");
    // Without these requests the SDK reports path, size, and date modified as unknown.
    for (const [propertyId, label] of [
      [PROPERTY_ID_FULL_PATH, "full path"],
      [PROPERTY_ID_SIZE, "size"],
      [PROPERTY_ID_DATE_MODIFIED, "date modified"],
    ]) {
      requireSuccess(
        sdk,
        sdk.addSearchPropertyRequest(searchState, propertyId),
        `Could not request the ${label} property`,
      );
    }
    // SDK 3.0.1.12 returns FALSE for these valid viewport updates.
    sdk.setSearchViewportOffset(searchState, offset);
    sdk.setSearchViewportCount(searchState, limit);

    resultList = sdk.search(client, searchState);
    if (isNullPointer(resultList)) throw sdkFailure(sdk, "Everything SDK v3 search failed");

    const totalMatches = jsonSafeUnsigned(sdk.getResultListCount(resultList));
    const viewportCount = Math.min(Number(sdk.getResultListViewportCount(resultList)), limit);
    const results = [];
    for (let index = 0; index < viewportCount; index += 1) {
      results.push({
        path: readFullPath(sdk, resultList, index),
        isFolder: Boolean(sdk.isFolderResult(resultList, index)),
        sizeBytes: sizeToJson(sdk.getResultSize(resultList, index)),
        dateModifiedUtc: fileTimeToIso(sdk.getResultDateModified(resultList, index)),
      });
    }

    // Everything reports the total independently of the viewport, so the caller can
    // page without guessing whether more matches exist.
    const consumed = offset + results.length;
    const hasMore = results.length > 0 && consumed < totalMatches;
    return {
      query,
      offset,
      limit,
      totalMatches,
      returned: results.length,
      hasMore,
      nextOffset: hasMore ? consumed : null,
      results,
    };
  } finally {
    safeDestroy(sdk.destroyResultList, resultList);
    safeDestroy(sdk.destroySearchState, searchState);
    safeDestroy(sdk.destroyClient, client);
  }
}

export async function searchEverything(input, options = {}) {
  const parameters = validateSearchInput(input);
  const sdk = options.sdk ?? (await loadSdk3(options.dllPath ?? resolveSdk3DllPath(options.resolveOptions)));
  return searchWithSdk3(sdk, parameters);
}
