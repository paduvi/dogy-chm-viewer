// Minimal type declaration for Electron's <webview> custom element.
// The webview renders sandboxed CHM content via chm:// protocol.

export interface WebviewHTMLElement extends HTMLElement {
  src: string
  loadURL(url: string, options?: unknown): Promise<void>
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  getURL(): string
  stop(): void
  addEventListener(event: 'did-navigate', handler: (e: { url: string }) => void): void
  addEventListener(event: 'did-navigate-in-page', handler: (e: { url: string; isMainFrame: boolean }) => void): void
  addEventListener(event: 'new-window', handler: (e: { url: string }) => void): void
  addEventListener(event: 'will-navigate', handler: (e: { url: string }) => void): void
  addEventListener(event: 'dom-ready', handler: () => void): void
  removeEventListener(event: string, handler: (...args: unknown[]) => unknown): void
}

declare namespace JSX {
  interface IntrinsicElements {
    webview: React.DetailedHTMLProps<React.HTMLAttributes<WebviewHTMLElement>, WebviewHTMLElement> & {
      src?: string
      allowpopups?: string
      disablewebsecurity?: string
      partition?: string
    }
  }
}
