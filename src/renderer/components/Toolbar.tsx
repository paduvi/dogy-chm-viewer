interface ToolbarProps {
  title: string | null
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  onOpen: () => void
  onBack: () => void
  onForward: () => void
}

export function Toolbar({ title, loading, canGoBack, canGoForward, onOpen, onBack, onForward }: ToolbarProps) {
  return (
    <header className="toolbar">
      <div className="toolbar-traffic-area" />
      <button className="toolbar-btn" onClick={onOpen} disabled={loading} title="Open CHM file">
        {loading ? '…' : '📂'}
        <span className="toolbar-label">{loading ? 'Opening…' : 'Open'}</span>
      </button>
      <div className="toolbar-sep" />
      <button className="toolbar-btn nav-btn" onClick={onBack} disabled={!canGoBack} title="Back (⌘[)">
        ‹
      </button>
      <button className="toolbar-btn nav-btn" onClick={onForward} disabled={!canGoForward} title="Forward (⌘])">
        ›
      </button>
      {title && <span className="toolbar-title">{title}</span>}
    </header>
  )
}
