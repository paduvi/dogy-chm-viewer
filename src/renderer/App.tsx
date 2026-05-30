import { useCallback } from 'react'
import { useChm } from './hooks/useChm'
import { Toolbar } from './components/Toolbar'
import { SidePanel } from './components/SidePanel'
import { ContentView } from './components/ContentView'

export function App() {
  const {
    doc, error, loading, currentUrl, canGoBack, canGoForward, sideTab,
    navigate, back, forward, setSideTab, clearError
  } = useChm()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (!file || !file.name.toLowerCase().endsWith('.chm')) return
    // file.path is empty in sandboxed Electron renderers (Electron 30+).
    // webUtils.getPathForFile() is only available in the preload context, so it
    // is bridged via window.chm.getPathForFile().
    const filePath = window.chm.getPathForFile(file)
    if (!filePath) return
    void window.chm.openInNewWindow(filePath)
  }, [])

  return (
    <div className="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      <Toolbar
        title={doc?.title ?? null}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onOpen={() => void window.chm.openInNewWindow()}
        onBack={back}
        onForward={forward}
      />

      {error && (
        <div className="error-banner" role="alert">
          <strong>Error:</strong> {error}
          <button className="error-dismiss" onClick={clearError}>✕</button>
        </div>
      )}

      <div className="workspace">
        {doc && (
          <SidePanel
            doc={doc}
            activeTab={sideTab}
            currentUrl={currentUrl}
            onTabChange={setSideTab}
            onNavigate={navigate}
          />
        )}
        <main className="content-area">
          <ContentView url={currentUrl} onNavigate={navigate} />
        </main>
      </div>
    </div>
  )
}
