import { createInterface } from "node:readline";
import { createRequestHandler } from "./mcp-protocol.mjs";

const handleRequest = createRequestHandler();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });

for await (const line of input) {
  if (!line.trim()) continue;

  let request;
  try {
    request = JSON.parse(line);
  } catch {
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error: expected one JSON-RPC message per line." },
      })}\n`,
    );
    continue;
  }

  try {
    const response = await handleRequest(request);
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const id = request && typeof request === "object" ? (request.id ?? null) : null;
    process.stdout.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: error instanceof Error ? error.message : String(error) },
      })}\n`,
    );
  }
}
