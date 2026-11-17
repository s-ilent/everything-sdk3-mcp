# Changelog

All notable changes to this project are documented here. This project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-11-16

### Added

- `hasMore` and `nextOffset` in search results, so clients can page without guessing.
- `outputSchema` for `search_files`, and results returned as both text and
  `structuredContent`.
- Tool annotations: `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`,
  and `title`.
- Protocol version negotiation across `2025-06-18`, `2025-03-26`, and `2024-11-05`.
- `bin/cli.mjs` with `--help` and `--version`.
- Live integration tests (`npm run test:live`) that skip when Everything is unavailable.

### Changed

- Unknown tool names now return a JSON-RPC protocol error (`-32602`) instead of an
  `isError` tool result, matching the specification.
- `totalMatches` is always a JSON integer; oversized values clamp to
  `Number.MAX_SAFE_INTEGER` instead of becoming strings.
- Package renamed to `everything-sdk3-mcp` and prepared for public release.

### Fixed

- Size and modification time were always `null`: SDK v3 only returns properties the
  search state requests, and requesting any property replaces the implicit `FULL_PATH`
  fallback. `FULL_PATH` (240) is now requested explicitly.
- Viewport setters return `FALSE` despite applying the value; their return code is no
  longer treated as failure.

## [0.2.0] - 2026-11-11

### Added

- SDK v3 named-pipe IPC transport via Koffi FFI.
- `search_files` tool with `query`, `limit`, and `offset`.
- Unit tests for query validation, FFI declarations, pagination, and MCP handling.

## [0.1.0] - 2026-11-11

- Initial prototype.
