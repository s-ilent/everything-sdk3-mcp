# everything-sdk3-mcp

A read-only [MCP](https://modelcontextprotocol.io) server that searches the local
[voidtools Everything](https://www.voidtools.com/) 1.5 index through the official
**SDK v3** named-pipe IPC.

It does **not** need `es.exe`, Everything's HTTP server, or a separate search process.
It never reads file contents, opens files, or modifies the index.

## Why SDK v3

Everything 1.5 ships an SDK v3 with a named-pipe IPC API that returns indexed metadata
directly, without the legacy `Everything_QueryW` round-trip or an HTTP server. This
server binds that API through [Koffi](https://koffi.dev) FFI.

## Requirements

- Windows x64
- Node.js 20 or newer
- Everything 1.5 running in the same user session
- The official **Everything SDK v3 x64 DLL**, `Everything3_x64.dll`

Download SDK v3 from [voidtools' official releases](https://github.com/voidtools/everything_sdk3/releases).
This project was written against SDK 3.0.1.12. The DLL is not bundled here.

## Install

```powershell
npm install -g everything-sdk3-mcp
```

Or run it without installing:

```powershell
npx -y everything-sdk3-mcp
```

Point the server at the DLL with `EVERYTHING_SDK3_DLL_PATH`, or place it at
`vendor\Everything3_x64.dll` next to the package.

## Configure your MCP client

```json
{
  "mcpServers": {
    "everything": {
      "command": "npx",
      "args": ["-y", "everything-sdk3-mcp"],
      "env": {
        "EVERYTHING_SDK3_DLL_PATH": "C:\\Tools\\Everything3_x64.dll"
      }
    }
  }
}
```

The server speaks JSON-RPC over stdin/stdout and opens no network port. Protocol
messages go to stdout only; diagnostics go to stderr.

## Tool

### `search_files`

Searches the index with Everything's native query syntax and returns indexed metadata.

| Parameter | Type | Default | Description |
|---|---|---|---|
| `query` | string | — | Required. Everything query, e.g. `report ext:pdf`, `dm:today`, `path:C:\Users`. |
| `limit` | integer | 25 | Results per page, 1–100. |
| `offset` | integer | 0 | Matches to skip. |

Response:

```json
{
  "query": "report ext:pdf",
  "offset": 0,
  "limit": 25,
  "totalMatches": 1174,
  "returned": 25,
  "hasMore": true,
  "nextOffset": 25,
  "results": [
    {
      "path": "C:\\Users\\Arukas\\Documents\\report.pdf",
      "isFolder": false,
      "sizeBytes": 2851825,
      "dateModifiedUtc": "2026-09-13T11:34:21.232Z"
    }
  ]
}
```

`totalMatches` is the full match count independent of paging. `hasMore` and
`nextOffset` let a client page without guessing. `sizeBytes` and `dateModifiedUtc` are
`null` when Everything has no value for the item.

The tool is annotated `readOnlyHint: true`, `destructiveHint: false`,
`idempotentHint: true`, `openWorldHint: false`, and declares an `outputSchema`; results
are returned as both text and `structuredContent`.

## Security

Everything's index contains file and folder names, paths, and metadata that may be
sensitive. This server exposes that index to whichever MCP client launches it, with no
additional access control — it runs with your user's privileges and returns whatever
Everything has indexed.

- Use it only with a trusted MCP client.
- It is read-only: no file contents, no writes, no index changes.
- It listens on stdio only and opens no network port.

## SDK v3 quirks this server handles

Two behaviours are easy to get wrong, and both are covered by tests:

- `Everything3_SetSearchViewportOffset` / `SetSearchViewportCount` return `FALSE` even
  when they apply the value. Their return code must not be treated as failure.
- Result properties are only populated when the search state requests them. Requesting
  size and date modified replaces the implicit `FULL_PATH` fallback, so
  `EVERYTHING3_PROPERTY_ID_FULL_PATH` (240) must be requested explicitly alongside them.

## Development

```powershell
npm install
npm test          # unit tests, no Everything required
npm run test:live # integration tests against a running Everything
npm start         # run the server on stdio
```

`npm run test:live` skips itself when the DLL or Everything's IPC pipe is unavailable.

### DSH bundle

`bundle/` is a configuration-only DSH bundle that registers this server through
`@deepseek-ai/dsh-mcp-client`, exposing `mcp__everything__search_files`. It is installed
into the desktop profile as a `file:` dependency:

```json
"dsh-everything-mcp": "file:M:/Development/everything-mcp/bundle"
```

with `dsh-everything-mcp` listed in `dsh.profile.bundles`.

### Source vs. deployed runtime

This repository is the **source of truth**. The MCP client does not run it directly;
it runs a **built runtime** assembled by `npm run build:runtime`:

| | Location | Role |
|---|---|---|
| Source | `M:\Development\everything-mcp` | Edit here. Tests, docs, build script. |
| Runtime | `<DSH workspace>\everything-mcp-runtime` | Generated. What DSH actually launches. |

The build copies the three server modules, `node_modules/` (Koffi), and the SDK DLL into
the target, writes a runtime-only `package.json`, and records SHA-256 hashes plus the
source path in `BUILD-INFO.json`. The target is wiped and rebuilt each time, so a deleted
file never lingers.

The runtime is self-contained: it reads nothing from the source tree, so the source can
be offline, moved, or deleted without breaking the tool. `BUILD-INFO.json` records the
source path as provenance only.

After editing source, rebuild and restart the server:

```powershell
npm run build:runtime
# then restart DSH, or stop the server process so DSH respawns it
```

The bundle's `cordis.patch.yml` points at the runtime directory. The DLL is resolved from
the runtime's `vendor\Everything3_x64.dll`, so no environment variable is needed.

Note: pnpm caches `file:` dependencies by content hash. After editing
`bundle/cordis.patch.yml`, delete `node_modules/dsh-everything-mcp` in the profile
before reinstalling, or the stale copy is reused.

## Protocol

Implements MCP `2025-06-18`, and negotiates down to `2025-03-26` or `2024-11-05` when a
client requests an older revision. It does not claim `2026-07-28`, whose per-request
`_meta` and `resultType` requirements it does not implement.

## License

MIT. The Everything SDK is distributed separately by voidtools under its own MIT
license; see [LICENSE](LICENSE).

## References

- [Everything 1.5 SDK v3 announcement](https://www.voidtools.com/forum/viewtopic.php?t=15853)
- [Everything SDK v3 source](https://github.com/voidtools/everything_sdk3)
- [Koffi FFI documentation](https://koffi.dev/load)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification)
