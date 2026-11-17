#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { version } = JSON.parse(readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"));

const HELP = `everything-sdk3-mcp ${version}

Read-only MCP server for the local voidtools Everything 1.5 index.
Speaks MCP JSON-RPC over stdin/stdout; it opens no network port.

Usage:
  everything-sdk3-mcp            Start the MCP server on stdio.
  everything-sdk3-mcp --help     Show this message.
  everything-sdk3-mcp --version  Print the version.

Environment:
  EVERYTHING_SDK3_DLL_PATH  Full path to Everything3_x64.dll.
                            Falls back to vendor/Everything3_x64.dll.

Requirements:
  Windows x64, Node.js 20+, and Everything 1.5 running in the same user session.
  SDK v3: https://github.com/voidtools/everything_sdk3/releases
`;

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  process.stdout.write(HELP);
  process.exit(0);
}
if (args.includes("--version") || args.includes("-v")) {
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

// Anything else is a client passing through; start serving.
await import("../server.mjs");
