import { useCallback } from 'react'
import { useChm } from './hooks/useChm'
import { Toolbar } from './components/Toolbar'
import { SidePanel } from './components/SidePanel'
import { ContentView } from './components/ContentView'

export function App() {
  const {
    doc, error, loading, currentUrl, canGoBack, canGoForward, sideTab,
    openChm, navigate, back, forward, setSideTab, clearError
  } = useChm()

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer.files[0]
      if (!file || !file.name.toLowerCase().endsWith('.chm')) return
      const filePath = (file as File & { path: string }).path
      if (!filePath) return
      void window.chm.openChm(filePath).then((result) => {
        if (result.ok) {
          const firstLocal = result.value.toc[0]?.localPath
          if (firstLocal) {
            const path = firstLocal.startsWith('/') ? firstLocal : '/' + firstLocal
            navigate(`chm://${result.value.chmId}${path}`)
          }
        }
      })
    },
    [navigate]
  )

  return (
    <div className="app" onDragOver={handleDragOver} onDrop={handleDrop}>
      <Toolbar
        title={doc?.title ?? null}
        loading={loading}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        onOpen={() => void openChm()}
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
