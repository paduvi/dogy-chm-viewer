# Dogy CHM Viewer

A macOS desktop application for viewing Microsoft Compiled HTML Help (`.chm`) files.
Ships as a **universal binary** supporting both Intel (x64) and Apple Silicon (arm64).

---

## Features

- **Table of contents** — hierarchical TOC with expand/collapse and active-page highlighting
- **Keyword index** — filterable index with sub-keyword indentation
- **Full-text search** — FlexSearch-powered as-you-type search with excerpts
- **Navigation** — back/forward history; click any TOC/index/search result to load that page
- **Multi-window** — each CHM opens in its own window; dragging or opening a file always gives a dedicated view
- **Finder integration** — double-click a `.chm` file in Finder to open it immediately
- **Drag & drop** — drag a `.chm` file onto any app window to open it
- **Native macOS** — menu bar, keyboard shortcuts, Open Recent, window-state persistence
- **Open Recent** — reopens previously viewed files from File → Open Recent

---

## Requirements

- **macOS** (Intel or Apple Silicon)
- **Node.js** v20+ and **npm** v10+

---

## Quick Start

```bash
npm install
npm run dev
```

Opens the Electron app with hot-reload.

---

## Opening Files

| Method | Behaviour |
|--------|-----------|
| `⌘O` / toolbar Open button | Shows a native Open dialog; opens the file in a new or existing empty window |
| File → Open Recent | Opens the file in a new or existing empty window |
| Drag `.chm` onto the window | Opens the file in that window (if empty) or a new window |
| Double-click `.chm` in Finder | Launches the app (if not running) and opens the file immediately |

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘O` | Open a CHM file |
| `⌘[` | Navigate back |
| `⌘]` | Navigate forward |
| `⌘F` | Focus Search tab |
| `⌘=` | Zoom in |
| `⌘-` | Zoom out |
| `⌘0` | Actual size |
| `⌘W` | Close window |

---

## Scripts

| Command | What it does |
|---------|-------------|
| `npm run dev` | Start Electron + Vite dev server with HMR |
| `npm run build` | Compile to `out/` (no packaging) |
| `npm run typecheck` | TypeScript type-check |
| `npm run lint` | ESLint |
| `npm test` | Vitest unit + integration + renderer tests |
| `npm run test:coverage` | Vitest with v8 coverage report |
| `npm run test:e2e` | Build then run Playwright end-to-end tests |
| `npm run bench` | FlexSearch vs MiniSearch performance benchmark |
| `npm run make-icon` | Regenerate `build/icon.icns` from `resources/dog_logo.jpg` |
| `npm run oracle:baselines` | Regenerate decode-correctness baselines (needs `brew install sevenzip chmlib`) |
| `npm run dist:mac` | Universal macOS DMG (Intel + Apple Silicon) |
| `npm run dist:mac:x64` | Intel-only DMG |
| `npm run dist:mac:arm64` | Apple Silicon-only DMG |

---

## Packaging & Distribution

```bash
npm run dist:mac
```

Packaged `.app` and `.dmg` are written to `dist/`. The build is ad-hoc signed
(no Team ID), which lets it run on any Mac. GitHub Actions automatically builds
and attaches the DMG to every pushed version tag (`v*.*.*`).

> **Gatekeeper note** — unsigned apps downloaded from the internet require a
> one-time bypass. Right-click the app → **Open**, or run:
> ```bash
> xattr -dr com.apple.quarantine "/Applications/Dogy CHM Viewer.app"
> ```

> **Signing & notarization** require an Apple Developer ID certificate. Set
> `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and
> `APPLE_TEAM_ID`, then set `hardenedRuntime: true` in `electron-builder.yml`
> and implement `scripts/notarize.js`. Once a real certificate is used, macOS
> Gatekeeper is satisfied automatically.

---

## Project Structure

```
src/
├── core/chm/       # Pure-TS CHM parser (no Electron imports, fully unit-tested)
│   ├── backend.ts  # ChmBackend interface — swappable decoder contract
│   ├── chm-file.ts # ITSF/ITSP/PMGL + LZX decoder (LGPL-2.1, see NOTICE.md)
│   ├── hhc.ts      # .hhc TOC parser → TocNode[]
│   ├── hhk.ts      # .hhk index parser → IndexEntry[]
│   ├── search.ts   # FlexSearch full-text index
│   └── mime.ts     # MIME types + path-traversal safety
├── main/           # Electron main process
│   ├── index.ts    # App lifecycle, multi-window management, Finder open-file
│   ├── ipc.ts      # IPC handlers (OPEN_CHM, RENDERER_MOUNTED, OPEN_IN_NEW_WINDOW…)
│   ├── menu.ts     # Native macOS menu (Open dialog handled in main process)
│   └── …           # window, chm-protocol, chm-session, recent-files, window-state
├── preload/        # contextBridge — typed window.chm API
│   └── index.ts    # getPathForFile, rendererMounted, onLoadFile, openInNewWindow…
├── renderer/       # React UI
│   ├── App.tsx     # Drag-and-drop, toolbar, workspace layout
│   ├── hooks/useChm.ts  # Central state, LOAD_FILE subscription, back/forward
│   └── components/ # TocTree, IndexList, SearchPanel, SidePanel, ContentView, Toolbar
└── shared/
    └── types.ts    # All types + IPC channel names (single source of truth)

tests/
├── unit/           # Parser unit tests (Vitest)
├── integration/    # Oracle + session + search tests (Vitest)
├── renderer/       # Hook tests — jsdom + Testing Library (Vitest)
└── e2e/            # Playwright end-to-end tests (7 scenarios)

resources/          # Sample .chm fixtures — do not delete (oracle tests depend on them)
build/              # App icon (icon.icns) and macOS entitlements
scripts/            # Dev tools: oracle baseline gen, icon generation, notarize hook
.github/workflows/  # release.yml — builds universal DMG and uploads to GitHub Releases
```

---

## Architecture

### Multi-window model

Each CHM opens in a dedicated `BrowserWindow`. The main process tracks which
windows are "loaded" (`loadedWindowIds`) and which have a file queued but not
yet delivered (`pendingFiles`).

File delivery uses two paths:

| Window state | Delivery |
|---|---|
| **Existing empty window** (renderer mounted) | Main pushes `LOAD_FILE` directly |
| **New window** (renderer not yet mounted) | Renderer signals `RENDERER_MOUNTED` once `onLoadFile` is wired; main then pushes `LOAD_FILE` |

This guarantees no message is ever lost to a listener-not-yet-registered race.

### Drag-and-drop

`file.path` returns an empty string in sandboxed Electron renderers (Electron 30+).
The drop handler uses `window.chm.getPathForFile(file)` instead, which bridges
`webUtils.getPathForFile()` from the preload context (the only place it is available).

### CHM decoding

Pure TypeScript behind a `ChmBackend` interface. No native modules → universal
(Intel + ARM) builds need no node-gyp/ABI rebuilds. Ported from `chmlib-ts` (LGPL-2.1,
see `src/core/chm/NOTICE.md`). Correctness is proven by an oracle test that asserts
byte-identical output against both `7-zip` and `chmlib` for every internal file of
every sample CHM (currently **981 files**).

### `chm://` custom protocol

CHM pages and assets are served via `chm://<sessionId>/internal/path`. Chromium
resolves relative links naturally, with no temp files and a clean security boundary.

### Security

`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. CHM HTML is
rendered only inside a sandboxed `<webview>` served by `chm://` — never injected into
the app shell. External links open in the system browser.

### Full-text search

FlexSearch `Document` index built lazily on first query (~570 ms for a 981-page CHM,
then cached for the session). Queries return in ~0.1 ms with title + excerpt.

---

See [CLAUDE.md](CLAUDE.md) for detailed architecture decisions, coding conventions,
and the testing strategy.
