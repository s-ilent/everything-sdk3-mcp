# Release checklist

Run through this before tagging a public release.

## 1. Verify the tree is clean

```powershell
git status --short          # expect no output
npm ci                      # lockfile must match package.json
```

## 2. Run the full test suite

```powershell
npm test                    # unit tests, no Everything required
npm run test:live           # integration tests against a running Everything
```

`test:live` skips when the DLL or Everything's IPC pipe is unavailable. A release
should have it actually run at least once on a machine with Everything installed.

## 3. Check the published contents

```powershell
npm pack --dry-run
```

Confirm the tarball contains `bin/`, `everything.mjs`, `mcp-protocol.mjs`,
`server.mjs`, `README.md`, `CHANGELOG.md`, and `LICENSE` — and that it does **not**
contain `node_modules/`, `test/`, `vendor/`, or any `.dll`.

## 4. Smoke-test the packed artifact

```powershell
npm pack
npm install -g .\everything-sdk3-mcp-0.3.0.tgz
everything-sdk3-mcp --version
everything-sdk3-mcp --help
```

Then point an MCP client at the installed binary and run one real search.

## 5. Publish

```powershell
npm publish --access public
```

`prepublishOnly` runs `npm test` first.

## 6. After publishing

- Tag the release: `git tag v0.3.0 && git push --tags`
- Create a GitHub release from the tag, pasting the `CHANGELOG.md` section.
- Verify the listing renders: `npm view everything-sdk3-mcp`
