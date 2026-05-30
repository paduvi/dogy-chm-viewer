# CLAUDE.md

Guidance for Claude Code (and humans) working in this repository.

## 1. Project Overview

**dogy-chm-viewer** is a macOS-only desktop application for viewing Microsoft
Compiled HTML Help (`.chm`) files. It ships as a **universal binary** (Intel
`x64` + Apple Silicon `arm64`).

Features delivered:
- TOC tree (expand/collapse, active-page highlight)
- Keyword index (filterable, depth-indented sub-keywords)
- Full-text search (FlexSearch, as-you-type prefix, excerpts)
- Back/forward navigation history
- Native macOS menu, keyboard shortcuts (⌘O/[/]/F/=/−/0), Open Recent, zoom
- Window state persistence and recent-files tracking
- `chm://` custom protocol — sandboxed CHM content rendering in `<webview>`
- Drag-and-drop `.chm` files onto the window

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
| CHM parser | **Pure TypeScript** (`ChmBackend` interface) | Zero node-gyp; universal builds trivial. Correctness proven by oracle (see §2.1). Swappable to native if needed. |
| Renderer UI | **React + TypeScript** | Largest ecosystem; easy to test. |
| Bundler / dev | **electron-vite** | HMR, TS out of the box. |
| Packaging | **electron-builder** | One-line universal DMG, signing config built in. |
| Search | **FlexSearch** (pure-JS, in-memory) | Benchmarked: ~570 ms build, ~0.13 ms queries, ~80 MB index for a 3,498-page CHM. Native engines are faster per-op but irrelevant at this scale and reintroduce native-build pain. |

### 2.1 Decode correctness

The parser's only contract: **extract every internal file byte-identical to a
trusted reference.** This is binary and provable — not "looks right."

Oracle test (`tests/integration/oracle.test.ts`): for every `resources/*.chm`,
our decoder's `read()` of **every** entry is asserted **byte-identical** to both
`chmlib` and `7-zip` output. Current coverage: **981 files** (PowerCollections.chm).
A single byte mismatch fails CI. Adding a new CHM and running
`npm run oracle:baselines` extends coverage instantly — the test picks up new
entries from the committed baseline JSON automatically.

Baselines live in `tests/fixtures/oracle-baselines.json` (committed). Regenerate:
```bash
npm run oracle:baselines   # requires: brew install sevenzip chmlib
```

**License:** the parser in `src/core/chm/` is ported from `chmlib-ts` (LGPL-2.1).
Files `buffer-reader.ts`, `itsf.ts`, `directory.ts`, `lzx.ts`, `chm-file.ts` are
**LGPL-2.1** — keep modifications under LGPL-2.1. See `src/core/chm/NOTICE.md`.
All other files are MIT/project license.

**Swappable backend:** `backend.ts` defines `ChmBackend` (`open` / `list` /
`read`). If a real-world CHM ever defeats the pure-TS decoder, a native binding
can slot in behind that interface with zero upstream changes. The oracle suite is
the signal — it tells you if that day has come.

### Process model

```
┌─────────────────────────────────────────────────────────────┐
│ Main process (Node)                                          │
│  • ChmFile decode, chm-session registry, FlexSearch index    │
│  • chm:// protocol handler                                   │
│  • IPC: open, getToc, getIndex, search                       │
│  • Menu, window state, recent files                          │
└───────────────▲─────────────────────────────┬───────────────┘
                │ contextBridge (typed)        │ chm:// requests
┌───────────────┴─────────────────────────────▼───────────────┐
│ Preload              │  Renderer (React)                      │
│  window.chm API      │  TocTree, IndexList, SearchPanel       │
│  onMenuAction()      │  ContentView (<webview>)               │
└──────────────────────────────────────────────────────────────┘
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
│   ├── index.ts           # App lifecycle
│   ├── window.ts          # BrowserWindow (hardened)
│   ├── window-state.ts    # Persist/restore window bounds
│   ├── chm-protocol.ts    # chm:// handler
│   ├── chm-session.ts     # Session registry (chmId → ChmFile + index)
│   ├── ipc.ts             # Typed IPC handlers
│   ├── menu.ts            # Native macOS menu
│   └── recent-files.ts    # Open Recent tracking
├── preload/
│   └── index.ts           # contextBridge → window.chm
├── renderer/
│   ├── App.tsx
│   ├── hooks/useChm.ts    # Central state, history, menu-action subscription
│   └── components/        # TocTree, IndexList, SearchPanel, SidePanel, ContentView, Toolbar
└── shared/
    └── types.ts           # All shared types + IPC channel names

tests/
├── unit/                  # parser.test.ts, sitemap.test.ts, mime.test.ts, chm-file.test.ts
├── integration/           # oracle.test.ts, document.test.ts, session.test.ts, search.test.ts
├── renderer/              # useChm.test.ts (jsdom + Testing Library)
├── e2e/                   # app.spec.ts (Playwright _electron)
└── bench/                 # search.bench.ts, search-flex.bench.ts

resources/                 # Sample .chm fixtures — NEVER delete (oracle tests depend on them)
build/                     # icon.icns, entitlements.mac.plist
scripts/                   # generate-oracle-baselines.mjs, make-icon.py, notarize.js
```

---

## 4. Testing Strategy

| Layer | Tool | What it covers |
|-------|------|----------------|
| Unit | **Vitest** | Pure parser functions: header/dir/LZXC parsing, MIME types, traversal safety, sitemap/entities, `ChmFile` guards. No Electron. |
| Oracle | **Vitest** | Every entry of every sample CHM extracted byte-identical to chmlib + 7-zip (981 files currently; grows automatically as samples are added). **CI gate.** |
| Integration | **Vitest** | TOC/index against real CHMs (no dangling links); session registry lifecycle; FlexSearch index (prefix match, excerpts, resolvable pages). |
| Renderer | **Vitest + jsdom + Testing Library** | `useChm`: navigation history, echo dedup, forward-truncation, open/error/cancel flows. |
| E2E | **Playwright `_electron`** | Launch built app, open CHM, render content, TOC nav, index, search — asserting no `ERR_ABORTED`. |

Key conventions:
- `resources/*.chm` are canonical fixtures. **Never modify or delete.** Currently: `PowerCollections.chm` (Wintellect .NET collection library, 981 internal files).
- Each bug fix adds a regression test.
- Bench suite (`tests/bench/`) documents search engine performance decisions — not run by `npm test`.
- CI order: `lint → typecheck → npm test`; E2E before release.
- Coverage target: ≥ 80% statements/lines/functions on `src/core/chm/` (branches ~70% — LZX has many data-dependent inner branches exercised by the oracle, not synthetic coverage).

---

## 5. Key Implementation Notes

### `chm://` URL scheme

Format: `chm://<chmId>/<internal/path.htm>` where `chmId` is a UUID from the
session registry. Chromium preserves the `chmId` host when resolving relative
links — images, CSS, and `<a href>` all stay bound to the same CHM session
automatically.

### ContentView webview navigation

Navigation is driven **only** through the `src` property setter (`wv.src = url`)
— never via a JSX `src` attribute and never via `loadURL()`. Setting both the
JSX attribute and an imperative load issues two competing `loadURL()` calls; the
second aborts the first → `ERR_ABORTED`. The `loadedUrl` ref tracks what's
currently loaded to avoid re-setting the same URL (which would reload the page).

### FlexSearch search flow

1. First query for a session triggers `buildSearchIndex(chmBackend)` (async, ~1 s).
2. The promise is cached in the session — concurrent queries share one build.
3. Index uses `tokenize: 'forward'` for prefix matching (~80 MB RAM for the large CHM).
4. Per-page text is kept in a separate `Map` for excerpt generation — not duplicated in the FlexSearch `store`.

### Window state persistence

Saved to `app.getPath('userData')/window-state.json` on resize/move/close.
On restore, bounds are validated against currently connected displays — if the
saved position is off-screen, defaults are used instead.

---

## 6. Build & Packaging

```bash
npm run dist:mac          # universal (Intel + Apple Silicon) DMG
npm run dist:mac:x64      # Intel only
npm run dist:mac:arm64    # Apple Silicon only
```

Output: `dist/`. Icon: `build/icon.icns` (regenerate with `npm run make-icon`).

**Signing & notarization** (required for public distribution):
- Set env vars: `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`.
- Fill in `scripts/notarize.js` using `@electron/notarize`.
- `electron-builder.yml` is already wired with `hardenedRuntime: true` and
  the `entitlements.mac.plist` (JIT + user-file-read entitlements).

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
