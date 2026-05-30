import { useState, useCallback, useRef, useEffect } from 'react'
import type { ChmDocument, MenuActionPayload } from '../../shared/types'

export type SideTab = 'toc' | 'index' | 'search'

export interface ChmState {
  doc: ChmDocument | null
  error: string | null
  loading: boolean
  currentUrl: string | null
  canGoBack: boolean
  canGoForward: boolean
  sideTab: SideTab
  navigate: (url: string) => void
  back: () => void
  forward: () => void
  setSideTab: (tab: SideTab) => void
  clearError: () => void
}

/** Build a chm:// URL from a chmId and an internal path (with optional fragment). */
export function chmUrl(chmId: string, localPath: string): string {
  const path = localPath.startsWith('/') ? localPath : '/' + localPath
  return `chm://${chmId}${path}`
}

export function useChm(): ChmState {
  const [doc, setDoc] = useState<ChmDocument | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [currentUrl, setCurrentUrl] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<SideTab>('toc')

  // Navigation history: array of URLs, pointer into it.
  const history = useRef<string[]>([])
  const histIdx = useRef(-1)

  const [canGoBack, setCanGoBack] = useState(false)
  const [canGoForward, setCanGoForward] = useState(false)

  const updateNavState = useCallback(() => {
    setCanGoBack(histIdx.current > 0)
    setCanGoForward(histIdx.current < history.current.length - 1)
  }, [])

  const navigate = useCallback(
    (url: string) => {
      // Ignore echoes: the webview confirms each navigation via did-navigate,
      // which calls navigate() again with the URL already at the cursor (true
      // for app clicks AND back/forward). Skipping these prevents duplicate
      // history entries without losing genuine navigations.
      if (history.current[histIdx.current] === url) return
      // Truncate forward history when navigating to a new URL.
      history.current = history.current.slice(0, histIdx.current + 1)
      history.current.push(url)
      histIdx.current = history.current.length - 1
      setCurrentUrl(url)
      updateNavState()
    },
    [updateNavState]
  )

  const back = useCallback(() => {
    if (histIdx.current <= 0) return
    histIdx.current--
    setCurrentUrl(history.current[histIdx.current] ?? null)
    updateNavState()
  }, [updateNavState])

  const forward = useCallback(() => {
    if (histIdx.current >= history.current.length - 1) return
    histIdx.current++
    setCurrentUrl(history.current[histIdx.current] ?? null)
    updateNavState()
  }, [updateNavState])

  const openChmPath = useCallback(async (filePath: string) => {
    setError(null)
    setLoading(true)
    const result = await window.chm.openChm(filePath)
    setLoading(false)
    if (!result.ok) { setError(result.error); return }
    const newDoc = result.value
    setDoc(newDoc)
    history.current = []
    histIdx.current = -1
    const firstLocal = newDoc.toc[0]?.localPath
    if (firstLocal) navigate(chmUrl(newDoc.chmId, firstLocal))
  }, [navigate])

  // Subscribe to LOAD_FILE pushes from main, then signal that we are ready.
  // Order matters: subscribe FIRST so the listener is wired before we tell
  // main it can push (rendererMounted). Main pushes LOAD_FILE only after this
  // signal, guaranteeing no message is lost to a listener-not-yet-registered race.
  useEffect(() => {
    const unsub = window.chm.onLoadFile((filePath) => {
      void openChmPath(filePath)
    })
    // Tell main the listener is ready. For new windows main will push the
    // queued file path now. For existing windows this is a no-op (no pending file).
    window.chm.rendererMounted()
    return unsub
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally empty — subscribe + signal exactly once on mount

  // Handle native menu commands: back/forward/search only.
  // 'open' and 'open-recent' are now fully handled in the main process.
  useEffect(() => {
    const unsubscribe = window.chm.onMenuAction((payload: MenuActionPayload) => {
      switch (payload.action) {
        case 'back': back(); break
        case 'forward': forward(); break
        case 'search': setSideTab('search'); break
      }
    })
    return unsubscribe
  }, [back, forward])

  return {
    doc, error, loading, currentUrl, canGoBack, canGoForward, sideTab,
    navigate, back, forward,
    setSideTab,
    clearError: () => setError(null)
  }
}
