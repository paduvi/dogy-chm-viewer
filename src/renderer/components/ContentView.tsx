import { useEffect, useRef } from 'react'
import type { WebviewHTMLElement } from '../webview'

interface ContentViewProps {
  url: string | null
  onNavigate: (url: string) => void
}

export function ContentView({ url, onNavigate }: ContentViewProps) {
  const ref = useRef<WebviewHTMLElement>(null)

  // The URL currently shown in the webview — updated both when WE navigate and
  // when the webview navigates itself (link clicks inside a page). The loader
  // only acts when the desired URL differs, so a navigation the webview already
  // performed is never re-issued (which would reload/flicker, or abort).
  const loadedUrl = useRef<string | null>(null)

  // Drive navigation through the `src` *property* setter — NOT a JSX `src`
  // attribute. Two reasons:
  //   1. One load path. Setting both the JSX attribute and an imperative load
  //      fires two competing loads; the second aborts the first → ERR_ABORTED.
  //   2. The `.src` setter initialises the guest and works immediately, with no
  //      dependence on the 'dom-ready' event (unlike loadURL(), which throws
  //      before the guest is attached — that gating left the view blank).
  useEffect(() => {
    const wv = ref.current
    if (!wv || !url) return
    if (loadedUrl.current !== url) {
      loadedUrl.current = url
      wv.src = url
    }
  }, [url])

  // Wire webview navigation events once.
  useEffect(() => {
    const wv = ref.current
    if (!wv) return

    // Record the webview's own navigation, then report it upward. Setting
    // loadedUrl FIRST means the loader sees it's already current and won't
    // re-issue a load for a navigation the webview just performed.
    const report = (navUrl: string): void => {
      if (!navUrl.startsWith('chm://')) return
      loadedUrl.current = navUrl
      onNavigate(navUrl)
    }
    const onDidNavigate = (e: { url: string }): void => report(e.url)
    const onInPage = (e: { url: string; isMainFrame: boolean }): void => {
      if (e.isMainFrame) report(e.url)
    }

    wv.addEventListener('did-navigate', onDidNavigate)
    wv.addEventListener('did-navigate-in-page', onInPage)

    return () => {
      wv.removeEventListener('did-navigate', onDidNavigate as (...args: unknown[]) => unknown)
      wv.removeEventListener('did-navigate-in-page', onInPage as (...args: unknown[]) => unknown)
    }
  }, [onNavigate])

  if (!url) {
    return (
      <div className="content-empty">
        <p>Open a <code>.chm</code> file to get started.</p>
        <p className="content-hint">File → Open, or drag a .chm file here.</p>
      </div>
    )
  }

  return <webview ref={ref} className="content-webview" />
}
