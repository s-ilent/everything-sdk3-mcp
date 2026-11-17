import assert from "node:assert/strict";
import test from "node:test";
import {
  createRequestHandler,
  MCP_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../mcp-protocol.mjs";

test("initializes as an MCP server with the tools capability", async () => {
  const handle = createRequestHandler();
  const response = await handle({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: MCP_PROTOCOL_VERSION },
  });
  assert.equal(response.result.protocolVersion, MCP_PROTOCOL_VERSION);
  assert.deepEqual(response.result.capabilities, { tools: { listChanged: false } });
});

test("echoes a supported client protocol version", () => {
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) {
    assert.equal(negotiateProtocolVersion(version), version);
  }
});

test("falls back to the highest supported version for unknown or missing revisions", () => {
  assert.equal(negotiateProtocolVersion("2026-07-28"), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion("1999-01-01"), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(undefined), MCP_PROTOCOL_VERSION);
  assert.equal(negotiateProtocolVersion(42), MCP_PROTOCOL_VERSION);
});

test("lists the read-only search tool with annotations and an output schema", async () => {
  const response = await createRequestHandler()({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  const tool = response.result.tools[0];
  assert.equal(tool.name, "search_files");
  assert.equal(typeof tool.title, "string");
  assert.deepEqual(tool.inputSchema.required, ["query"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(tool.annotations, {
    title: "Search the Everything index",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(tool.outputSchema.type, "object");
  assert.deepEqual(tool.outputSchema.required, [
    "query",
    "offset",
    "limit",
    "totalMatches",
    "returned",
    "hasMore",
    "nextOffset",
    "results",
  ]);
});

test("dispatches a search call and returns text plus structured content", async () => {
  const payload = { query: "draft", results: [{ path: "C:\\docs\\draft.txt" }] };
  const handle = createRequestHandler({ search: async (args) => ({ ...payload, query: args.query }) });
  const response = await handle({
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: { name: "search_files", arguments: { query: "draft" } },
  });
  assert.equal(response.result.content[0].type, "text");
  assert.deepEqual(JSON.parse(response.result.content[0].text), payload);
  assert.deepEqual(response.result.structuredContent, payload);
  assert.equal(response.result.isError, false);
});

test("reports an unknown tool as a protocol error", async () => {
  const response = await createRequestHandler()({
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "nope", arguments: {} },
  });
  assert.equal(response.error.code, -32602);
  assert.match(response.error.message, /Unknown tool: nope/);
  assert.equal(response.result, undefined);
});

test("returns tool execution errors as isError results and ignores notifications", async () => {
  const handle = createRequestHandler({ search: async () => { throw new Error("ES missing"); } });
  const failed = await handle({
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "search_files", arguments: { query: "draft" } },
  });
  assert.equal(failed.result.isError, true);
  assert.match(failed.result.content[0].text, /ES missing/);
  assert.equal(await handle({ jsonrpc: "2.0", method: "notifications/initialized" }), null);
});

test("rejects unknown methods with a protocol error", async () => {
  const response = await createRequestHandler()({ jsonrpc: "2.0", id: 6, method: "tools/nope" });
  assert.equal(response.error.code, -32601);
});
