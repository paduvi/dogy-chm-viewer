import type { ChmDocument } from '../../shared/types'
import type { SideTab } from '../hooks/useChm'
import { TocTree } from './TocTree'
import { IndexList } from './IndexList'
import { SearchPanel } from './SearchPanel'

interface SidePanelProps {
  doc: ChmDocument
  activeTab: SideTab
  currentUrl: string | null
  onTabChange: (tab: SideTab) => void
  onNavigate: (url: string) => void
}

export function SidePanel({ doc, activeTab, currentUrl, onTabChange, onNavigate }: SidePanelProps) {
  return (
    <aside className="side-panel">
      <div className="side-tabs">
        <button
          className={`side-tab${activeTab === 'toc' ? ' side-tab--active' : ''}`}
          onClick={() => onTabChange('toc')}
        >
          Contents
        </button>
        {doc.index.length > 0 && (
          <button
            className={`side-tab${activeTab === 'index' ? ' side-tab--active' : ''}`}
            onClick={() => onTabChange('index')}
          >
            Index
          </button>
        )}
        <button
          className={`side-tab${activeTab === 'search' ? ' side-tab--active' : ''}`}
          onClick={() => onTabChange('search')}
        >
          Search
        </button>
      </div>
      <div className="side-content">
        {activeTab === 'toc' && (
          <TocTree nodes={doc.toc} currentUrl={currentUrl} chmId={doc.chmId} onNavigate={onNavigate} />
        )}
        {activeTab === 'index' && (
          <IndexList entries={doc.index} chmId={doc.chmId} onNavigate={onNavigate} />
        )}
        {activeTab === 'search' && <SearchPanel chmId={doc.chmId} onNavigate={onNavigate} />}
      </div>
    </aside>
  )
}
