# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## 1. Project Overview

**dogy-chm-viewer** is a macOS-only desktop application for viewing Microsoft
Compiled HTML Help (`.chm`) files. It ships as a **universal binary** (Intel
`x64` + Apple Silicon `arm64`).

Features delivered:
- Multi-window — each CHM opens in its own `BrowserWindow`
- TOC tree (expand/collapse, active-page highlight)
- Keyword index (filterable, depth-indented sub-keywords)
- Full-text search (FlexSearch, as-you-type prefix, excerpts)
- Back/forward navigation history
- Native macOS menu, keyboard shortcuts (⌘O/[/]/F/=/−/0), Open Recent, zoom
- Window state persistence and recent-files tracking
- `chm://` custom protocol — sandboxed CHM content rendering in `<webview>`
- Drag-and-drop `.chm` files onto any window
- Finder integration — double-click `.chm` opens it immediately in the app
- GitHub Actions CI — builds universal DMG and uploads to release page on tag push

### CHM format

The sample files use **LZX compression** (transform GUID
`{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}`). Each CHM is a container of `.htm`
pages, assets (`.gif`/`.png`/`.jpg`/`.css`), a `.hhc` (TOC sitemap), and
optionally a `.hhk` (index).

**Key insight:** the CHM decoder only enumerates and extracts files. TOC, index,
and search are built on top of raw extraction:
- TOC ← parse `.hhc` (nested `<OBJECT type="text/sitemap">` entries).
- Index ← parse `.hhk` (same structure).
- Goto ← each entry's `Local` param is an internal path → `chm://` URL.
- Search ← extract every `.htm`, strip markup, index with FlexSearch.

---

## 2. Architecture

### Technology choices

| Concern | Choice | Rationale |
|---------|--------|-----------|
| CHM parser | **Pure TypeScript** (`ChmBackend` interface) | Zero node-gyp; universal builds trivial. Swappable to native if needed. |
| Renderer UI | **React + TypeScript** | Largest ecosystem; easy to test. |
| Bundler / dev | **electron-vite** | HMR, TS out of the box. |
| Packaging | **electron-builder** | One-line universal DMG, signing config built in. |
| Search | **FlexSearch** (pure-JS, in-memory) | ~570 ms build, ~0.13 ms queries, ~80 MB index for a 3,498-page CHM. |

### 2.1 Decode correctness

The parser's only contract: **extract every internal file byte-identical to a
trusted reference.**

Oracle test (`tests/integration/oracle.test.ts`): for every `resources/*.chm`,
our decoder's `read()` of **every** entry is asserted **byte-identical** to both
`chmlib` and `7-zip` output. Current coverage: **981 files** (PowerCollections.chm).

Baselines live in `tests/fixtures/oracle-baselines.json`. Regenerate:
```bash
npm run oracle:baselines   # requires: brew install sevenzip chmlib
```

**License:** `src/core/chm/` is ported from `chmlib-ts` (LGPL-2.1). Keep
modifications to those files under LGPL-2.1. See `src/core/chm/NOTICE.md`.

### 2.2 Multi-window model

Each `BrowserWindow` hosts exactly one CHM (or is "empty" waiting for a file).
The main process (`index.ts`) tracks state in two module-level collections:

```
loadedWindowIds: Set<number>          // BrowserWindow IDs that already have a CHM
pendingFiles:    Map<number, string>  // webContentsId → queued filePath
```

**File delivery — two paths depending on window state:**

| Window state | Mechanism |
|---|---|
| **Existing empty window** (renderer already mounted) | Main calls `webContents.send(IPC.LOAD_FILE, filePath)` immediately. |
| **Brand-new window** (renderer not yet mounted) | Main stores `filePath` in `pendingFiles`. Renderer mounts, subscribes to `onLoadFile`, then sends `IPC.RENDERER_MOUNTED` (fire-and-forget). Main's `ipcMain.on(RENDERER_MOUNTED)` handler reads `pendingFiles`, deletes the entry, and sends `LOAD_FILE`. |

**Why not `did-finish-load` + push?** `did-finish-load` fires in the main process
before React's `useEffect` has run in the renderer, so the `onLoadFile` listener
is not yet wired. A push there is silently lost. The `RENDERER_MOUNTED` signal
explicitly guarantees the listener is ready.

**Why not pull (`GET_PENDING_FILE` IPC) on mount?** Removed because `app.windows()`
in Playwright (and fast-navigation edge cases) could deliver the IPC before
`pendingFiles.set` completed — a race with no deterministic fix.

### 2.3 Drag-and-drop

`file.path` on `File` objects from HTML5 drag events returns an **empty string**
in sandboxed Electron renderers (Electron 30+). The fix:

```ts
// preload/index.ts — bridges webUtils (only available in preload context)
getPathForFile: (file: File): string => webUtils.getPathForFile(file),

// renderer/App.tsx — uses the bridge instead of file.path
const filePath = window.chm.getPathForFile(file)
```

### 2.4 `chm://` URL scheme

Format: `chm://<chmId>/<internal/path.htm>` where `chmId` is a UUID from the
session registry. Chromium preserves the `chmId` host when resolving relative
links — images, CSS, and `<a href>` all stay bound to the same CHM session
automatically.

### 2.5 ContentView webview navigation

Navigation is driven **only** through the `src` *property* setter (`wv.src = url`)
— never via a JSX `src` attribute and never via `loadURL()`. Setting both the
JSX attribute and an imperative load issues two competing `loadURL()` calls; the
second aborts the first → `ERR_ABORTED`. The `loadedUrl` ref tracks what is
currently loaded to avoid re-setting the same URL.

### 2.6 Code-signing and hardened runtime

Ad-hoc signed builds use `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` and
`hardenedRuntime: false`. Hardened runtime must be **OFF** for ad-hoc builds
because it enables **Library Validation**, which requires all loaded binaries to
share the same Team ID — ad-hoc signatures have none, so dyld rejects the
Electron Framework with "different Team IDs".

For a notarized Developer ID release: set `hardenedRuntime: true`, provide real
signing secrets, and implement `scripts/notarize.js`.

### 2.7 FlexSearch search flow

1. First query for a session triggers `buildSearchIndex(chmBackend)` (async, ~1 s).
2. The promise is cached in the session — concurrent queries share one build.
3. Index uses `tokenize: 'forward'` for prefix matching (~80 MB RAM for the large CHM).
4. Per-page text is kept in a separate `Map` for excerpt generation.

### 2.8 Window state persistence

Saved to `app.getPath('userData')/window-state.json` on resize/move/close.
On restore, bounds are validated against currently connected displays.

### Process model

```
┌─────────────────────────────────────────────────────────────────────┐
│ Main process (Node)                                                  │
│  • ChmFile decode, chm-session registry, FlexSearch index            │
│  • chm:// protocol handler                                           │
│  • IPC: OPEN_CHM, RENDERER_MOUNTED, OPEN_IN_NEW_WINDOW, LOAD_FILE   │
│  • Multi-window management (loadedWindowIds, pendingFiles)           │
│  • Menu (Open dialog runs in main), Finder open-file, recent files  │
└───────────────▲─────────────────────────────────┬───────────────────┘
                │ contextBridge (typed)            │ chm:// requests
┌───────────────┴─────────────────────────────────▼───────────────────┐
│ Preload              │  Renderer (React)                              │
│  window.chm API      │  TocTree, IndexList, SearchPanel               │
│  getPathForFile()    │  ContentView (<webview>)                       │
│  rendererMounted()   │  useChm hook (LOAD_FILE subscription)          │
│  onLoadFile()        │                                                │
└──────────────────────────────────────────────────────────────────────┘
```

### Security (non-negotiable — CHM content is untrusted HTML)

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webviewTag: true`.
- CHM HTML rendered **only** inside `<webview>` served by `chm://` — never injected into the app DOM.
- `chm://` paths validated: must start with `/`, no `..` segments (`isSafeInternalPath`).
- External `http(s)` links open in the system browser via `shell.openExternal`.
- CSP on the app shell; `chm://` content has no IPC/Node access.

---

## 3. Directory Structure

```
src/
├── core/chm/              # Pure-TS, no Electron — unit-testable in plain Node
│   ├── NOTICE.md          # LGPL-2.1 provenance
│   ├── backend.ts         # ChmBackend interface (swappable)
│   ├── buffer-reader.ts   # LE reader + ENCINT (LGPL-2.1)
│   ├── itsf.ts            # ITSF header (LGPL-2.1)
│   ├── directory.ts       # ITSP/PMGL/PMGI directory (LGPL-2.1)
│   ├── lzx.ts             # LZX decompressor + LZXC metadata (LGPL-2.1)
│   ├── chm-file.ts        # ChmBackend implementation (LGPL-2.1)
│   ├── sitemap.ts         # Tolerant .hhc/.hhk tokenizer
│   ├── hhc.ts             # .hhc → TocNode[]
│   ├── hhk.ts             # .hhk → IndexEntry[]
│   ├── document.ts        # Assemble ChmDocument from a backend
│   ├── mime.ts            # MIME types + path-safety
│   ├── path-utils.ts      # basename, stripFragment
│   └── search.ts          # FlexSearch index builder
├── main/
│   ├── index.ts           # App lifecycle, multi-window mgmt, Finder open-file
│   ├── window.ts          # BrowserWindow factory (hardened options)
│   ├── window-state.ts    # Persist/restore window bounds
│   ├── chm-protocol.ts    # chm:// handler
│   ├── chm-session.ts     # Session registry (chmId → ChmFile + index)
│   ├── ipc.ts             # Typed IPC handlers
│   ├── menu.ts            # Native macOS menu (Open dialog in main process)
│   └── recent-files.ts    # Open Recent tracking
├── preload/
│   └── index.ts           # contextBridge → window.chm
│                          #   getPathForFile, rendererMounted, onLoadFile,
│                          #   openInNewWindow, openChm, getToc, getIndex,
│                          #   search, onMenuAction
├── renderer/
│   ├── App.tsx            # Drag-and-drop handler, toolbar, workspace layout
│   ├── hooks/useChm.ts    # Central state, LOAD_FILE subscription, history
│   └── components/        # TocTree, IndexList, SearchPanel, SidePanel,
│                          # ContentView, Toolbar
└── shared/
    └── types.ts           # All shared types + IPC channel names

tests/
├── unit/                  # parser.test.ts, sitemap.test.ts, mime.test.ts, chm-file.test.ts
├── integration/           # oracle.test.ts, document.test.ts, session.test.ts, search.test.ts
├── renderer/              # useChm.test.ts (jsdom + Testing Library)
├── e2e/                   # app.spec.ts (Playwright _electron — 7 scenarios)
└── bench/                 # search.bench.ts, search-flex.bench.ts

resources/                 # Sample .chm fixtures — NEVER delete (oracle tests depend on them)
build/                     # icon.icns, entitlements.mac.plist
scripts/                   # generate-oracle-baselines.mjs, make-icon.py, notarize.js
.github/
└── workflows/
    └── release.yml        # CI: lint → typecheck → test → dist:mac → upload DMG
```

---

## 4. IPC Channels

All channel names live in `src/shared/types.ts` (`IPC` const object — single
source of truth for main, preload, and renderer).

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `chm:open` | renderer → main | Parse and open a CHM file; returns `ChmDocument` |
| `chm:get-toc` | renderer → main | Return `TocNode[]` for a session |
| `chm:get-index` | renderer → main | Return `IndexEntry[]` for a session |
| `chm:search` | renderer → main | Full-text search; returns `SearchResult[]` |
| `chm:open-dialog` | renderer → main | Legacy Open dialog (now mostly superseded by `open-in-new-window`) |
| `chm:open-in-new-window` | renderer → main | Open a file (or show dialog if path `null`) in a new/empty window |
| `chm:renderer-mounted` | renderer → main | Fire-and-forget; signals that `onLoadFile` listener is wired |
| `chm:load-file` | main → renderer | Push a file path to a mounted renderer |
| `menu:action` | main → renderer | Menu commands: `back`, `forward`, `search` |

---

## 5. Testing Strategy

| Layer | Tool | What it covers |
|-------|------|----------------|
| Unit | **Vitest** | Pure parser functions: header/dir/LZXC parsing, MIME types, traversal safety, sitemap/entities, `ChmFile` guards. No Electron. |
| Oracle | **Vitest** | Every entry of every sample CHM extracted byte-identical to chmlib + 7-zip (981 files). **CI gate.** |
| Integration | **Vitest** | TOC/index against real CHMs; session registry lifecycle; FlexSearch (prefix match, excerpts, resolvable pages). |
| Renderer | **Vitest + jsdom + Testing Library** | `useChm`: navigation history, echo dedup, forward-truncation, LOAD_FILE push, RENDERER_MOUNTED signal. |
| E2E | **Playwright `_electron`** | 7 scenarios: empty state, drag-and-drop IPC chain, multi-window, TOC nav, index, search, no protocol errors. |

Key conventions:
- `resources/*.chm` are canonical fixtures. **Never modify or delete.**
- Each bug fix adds a regression test.
- Bench suite (`tests/bench/`) documents search performance — not run by `npm test`.
- CI order: `lint → typecheck → npm test`; E2E before release.
- Coverage target: ≥ 80% statements/lines/functions on `src/core/chm/`.

### E2E Playwright notes (important gotchas)

`app.windows()` in Playwright electron includes **webview guest pages** (the CHM
content rendered inside `<webview>` tags), not just top-level `BrowserWindow` pages.

**Consequences:**

1. **`app.waitForEvent('window')` fires for webviews.** Do NOT use it to detect a
   new `BrowserWindow`. Instead, poll with:
   ```ts
   app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.id))
   ```
   and compare against a previously captured snapshot.

2. **Closing a webview's Playwright `Page` crashes the webview** and can reload
   the parent renderer, wiping React state (doc becomes null, `.toc-list`
   disappears). Always close extra windows from the main process:
   ```ts
   app.evaluate(({ BrowserWindow }, id) => {
     BrowserWindow.getAllWindows().filter(w => w.id !== id).forEach(w => w.close())
   }, mainWindowId)
   ```
   Then poll until `BrowserWindow.getAllWindows().length === 1`.

3. **`.toc-list` is conditionally rendered** — only when the Contents tab is active.
   Use `.side-tabs` as the "CHM is loaded" guard in tests that switch to the Index
   or Search tab before checking for results.

---

## 6. Build & Packaging

```bash
npm run dist:mac          # universal (Intel + Apple Silicon) DMG
npm run dist:mac:x64      # Intel only
npm run dist:mac:arm64    # Apple Silicon only
```

Output: `dist/`. Icon: `build/icon.icns` (regenerate with `npm run make-icon`).

### CI / GitHub Actions

`.github/workflows/release.yml` triggers on `v*.*.*` tags:
1. `npm run lint` + `npm run typecheck` + `npm test`
2. `npx electron-builder --mac --universal --publish never`
   - `CSC_IDENTITY_AUTO_DISCOVERY: 'false'` — skips signing (no cert configured)
   - `hardenedRuntime: false` in `electron-builder.yml` (required for ad-hoc; see §2.6)
3. `softprops/action-gh-release@v2` uploads `dist/*.dmg` to the GitHub release page

To cut a release:
```bash
git tag v1.0.0 && git push origin v1.0.0
```

**To enable signing:** set `CSC_LINK`, `CSC_KEY_PASSWORD`, and Apple notarization
secrets in GitHub repo Settings → Secrets, flip `hardenedRuntime` back to `true`,
and implement `scripts/notarize.js`.

### File type association

`electron-builder.yml` registers `.chm` via `fileAssociations`. After installing,
users can set Dogy CHM Viewer as the default handler from Finder → Get Info.

---

## 7. Coding Conventions

**Types**
- `strict: true`. No `any` — use `unknown` + narrowing.
- All cross-process types and IPC channel names in `src/shared/types.ts`.
- Binary parsing: `DataView`, little-endian. Named helpers (`readU32LE`, `readEncint`).

**Naming**
- Files: `kebab-case.ts`. Components: `PascalCase.tsx` (one per file).
- Functions/vars: `camelCase`. Types/interfaces: `PascalCase`. Constants: `UPPER_SNAKE_CASE`.

**Structure**
- `src/core/chm/` must be Electron/DOM-free — runs in plain Node and tests.
- Main ↔ renderer only through the typed preload bridge.
- No floating promises (`void` for intentionally fire-and-forget).
- No native dependencies — breaks the universal-build guarantee. Raise before adding.

**Style**
- Prettier formats; ESLint (typescript-eslint, react, react-hooks) gates CI.
- Arrow function types in interfaces (e.g. `onNavigate: (url: string) => void`),
  not method signatures — avoids `@typescript-eslint/unbound-method` false positives.
- Comments explain *why*, not *what*.

---

## References

- electron-vite — https://electron-vite.org/
- electron-builder (mac universal) — https://www.electron.build/
- FlexSearch — https://github.com/nextapps-de/flexsearch
- chmlib-ts (LGPL-2.1, ported for the decoder) — https://github.com/dmihal/chmlib-ts
- Electron `webUtils.getPathForFile` — https://www.electronjs.org/docs/latest/api/web-utils
