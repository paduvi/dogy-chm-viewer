# Dogy CHM Viewer

A macOS desktop application for viewing Microsoft Compiled HTML Help (`.chm`) files.
Ships as a **universal binary** supporting both Intel (x64) and Apple Silicon (arm64).

---

## Features

- **Table of contents** — hierarchical TOC with expand/collapse and active-page highlighting
- **Keyword index** — filterable index with sub-keyword indentation
- **Full-text search** — FlexSearch-powered as-you-type search across all pages, with excerpts
- **Navigation** — back/forward history, click any TOC/index/search result to load that page
- **Native macOS integration** — menu bar, keyboard shortcuts, window state persistence, recent files
- **Drag & drop** — drag a `.chm` file onto the window to open it

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

## Packaging

```bash
npm run dist:mac
```

Packaged `.app` and `.dmg` are written to `dist/`.

> **Signing & notarization** require an Apple Developer ID certificate and App Store Connect
> API key. Set `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` environment
> variables, then fill in `scripts/notarize.js`. Until configured, macOS Gatekeeper blocks
> the unsigned app — right-click → Open to bypass during development.

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
├── main/           # Electron main process (window, IPC, chm:// protocol, menu)
├── preload/        # contextBridge — typed window.chm API
├── renderer/       # React UI (TOC tree, index list, search panel, content webview)
└── shared/
    └── types.ts    # Types and IPC channel names shared across all processes

tests/
├── unit/           # Parser unit tests (Vitest)
├── integration/    # Oracle + session + search tests (Vitest)
├── renderer/       # Hook tests — jsdom + Testing Library (Vitest)
└── e2e/            # Playwright end-to-end tests

resources/          # Sample .chm fixtures — do not delete (used by oracle tests)
build/              # App icon (icon.icns) and entitlements
scripts/            # Dev-only tools: oracle baseline gen, icon generation, notarize
```

---

## Architecture

- **CHM decoding** — pure TypeScript behind a `ChmBackend` interface. No native modules, so universal (Intel + ARM) builds need no node-gyp/ABI rebuilds. The decoder is ported from the `chmlib-ts` lineage (LGPL-2.1 — see `src/core/chm/NOTICE.md`).

- **Correctness guarantee** — an oracle test suite extracts every internal file of every sample CHM with both `7-zip` and `chmlib`, and asserts our decoder produces byte-identical output for every entry. Currently covers **981 files** across the sample in `resources/`; adding a new CHM and running `npm run oracle:baselines` extends coverage instantly. A mismatch on any byte fails CI.

- **`chm://` custom protocol** — CHM pages and their assets (images, CSS) are served via `chm://<sessionId>/internal/path`. Chromium resolves relative links naturally, with no temp files and a clean security boundary.

- **Security** — `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. CHM HTML is rendered only inside a sandboxed `<webview>` served by the `chm://` protocol — never injected into the app shell. External links open in the system browser.

- **Full-text search** — FlexSearch `Document` index built lazily on first query (~1 s for a 3,500-page CHM, then cached for the session). Queries return in ~0.1 ms with title + excerpt.

See [CLAUDE.md](CLAUDE.md) for architecture decisions, coding conventions, and testing strategy.
