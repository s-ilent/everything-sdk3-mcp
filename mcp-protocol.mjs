import { searchEverything } from "./everything.mjs";

// Highest revision this server implements. It speaks the 2025-06-18 shape
// (content + structuredContent + outputSchema) and does not implement the
// 2026-07-28 per-request _meta/resultType requirements, so it must not claim it.
export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const SUPPORTED_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SEARCH_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    query: { type: "string", description: "The normalized query that was executed." },
    offset: { type: "integer", description: "Number of matches skipped." },
    limit: { type: "integer", description: "Maximum number of results requested." },
    totalMatches: {
      type: "integer",
      description: "Total number of indexed items matching the query, independent of paging.",
    },
    returned: { type: "integer", description: "Number of results in this response." },
    hasMore: { type: "boolean", description: "Whether matches exist beyond this page." },
    nextOffset: {
      oneOf: [{ type: "integer" }, { type: "null" }],
      description: "Offset to pass on the next call, or null when this is the last page.",
    },
    results: {
      type: "array",
      description: "Indexed metadata for each match. File contents are never read.",
      items: {
        type: "object",
        properties: {
          path: { type: "string", description: "Full path of the file or folder." },
          isFolder: { type: "boolean", description: "True when the match is a folder." },
          sizeBytes: {
            oneOf: [{ type: "integer" }, { type: "null" }],
            description: "Size in bytes, or null when Everything has no size for the item.",
          },
          dateModifiedUtc: {
            oneOf: [{ type: "string" }, { type: "null" }],
            description: "ISO 8601 modification time in UTC, or null when unknown.",
          },
        },
        required: ["path", "isFolder", "sizeBytes", "dateModifiedUtc"],
        additionalProperties: false,
      },
    },
  },
  required: ["query", "offset", "limit", "totalMatches", "returned", "hasMore", "nextOffset", "results"],
  additionalProperties: false,
};

const SEARCH_TOOL = {
  name: "search_files",
  title: "Search the Everything index",
  description:
    "Search the local voidtools Everything 1.5 index through its SDK v3 named-pipe IPC. " +
    "Returns indexed file and folder metadata only; it never reads or changes file contents. " +
    "Supports Everything's native query syntax and offset/limit paging.",
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          'Required Everything query, e.g. "report ext:pdf", "path:C:\\\\Users\\\\Arukas\\\\Documents", or "dm:today".',
        minLength: 1,
        maxLength: 4096,
      },
      limit: {
        type: "integer",
        description: "Maximum number of results to return (1–100; default 25).",
        minimum: 1,
        maximum: 100,
        default: 25,
      },
      offset: {
        type: "integer",
        description: "Number of matching results to skip for pagination (default 0).",
        minimum: 0,
        maximum: 1000000000,
        default: 0,
      },
    },
    required: ["query"],
    additionalProperties: false,
  },
  outputSchema: SEARCH_OUTPUT_SCHEMA,
  annotations: {
    title: "Search the Everything index",
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
};

function jsonRpcError(id, code, message) {
  return {
    jsonrpc: "2.0",
    id: id ?? null,
    error: { code, message },
  };
}

function toolError(message) {
  return {
    content: [{ type: "text", text: message }],
    isError: true,
  };
}

// Echo the client's revision when this server implements it; otherwise answer with
// the highest one it does, which is what the specification requires.
export function negotiateProtocolVersion(requested) {
  return typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
    ? requested
    : MCP_PROTOCOL_VERSION;
}

export function createRequestHandler({ search = searchEverything } = {}) {
  return async function handleRequest(request) {
    const hasId = Object.hasOwn(request ?? {}, "id");
    const id = hasId ? request.id : undefined;
    if (!request || typeof request !== "object" || request.jsonrpc !== "2.0") {
      return hasId ? jsonRpcError(id, -32600, "Invalid JSON-RPC request.") : null;
    }

    const method = request.method;
    if (typeof method !== "string") {
      return hasId ? jsonRpcError(id, -32600, "Request method must be a string.") : null;
    }

    if (method === "notifications/initialized" || method === "notifications/cancelled") {
      return null;
    }

    // JSON-RPC notifications never receive a response, including unknown methods.
    if (!hasId) return null;

    if (method === "initialize") {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: negotiateProtocolVersion(request.params?.protocolVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "voidtools-everything", version: "0.3.0" },
          instructions:
            "This server searches the local Everything 1.5 index through SDK v3 named-pipe IPC. " +
            "Search results reveal indexed names, paths, and metadata; file contents are not read.",
        },
      };
    }

    if (method === "ping") {
      return { jsonrpc: "2.0", id, result: {} };
    }

    if (method === "tools/list") {
      return { jsonrpc: "2.0", id, result: { tools: [SEARCH_TOOL] } };
    }

    if (method === "tools/call") {
      const parameters = request.params ?? {};
      // An unknown tool is a protocol error, not a tool execution error: the model
      // cannot fix it by changing arguments.
      if (parameters.name !== SEARCH_TOOL.name) {
        return jsonRpcError(id, -32602, `Unknown tool: ${String(parameters.name ?? "(missing name)")}`);
      }
      try {
        const result = await search(parameters.arguments ?? {});
        return {
          jsonrpc: "2.0",
          id,
          result: {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
            structuredContent: result,
            isError: false,
          },
        };
      } catch (error) {
        return {
          jsonrpc: "2.0",
          id,
          result: toolError(error instanceof Error ? error.message : String(error)),
        };
      }
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  };
}
