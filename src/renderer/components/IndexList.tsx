import { useState, useDeferredValue } from 'react'
import type { IndexEntry } from '../../shared/types'

interface IndexListProps {
  entries: IndexEntry[]
  chmId: string
  onNavigate: (url: string) => void
}

export function IndexList({ entries, chmId, onNavigate }: IndexListProps) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)

  const filtered =
    deferred.trim() === ''
      ? entries
      : entries.filter((e) => e.name.toLowerCase().includes(deferred.toLowerCase()))

  return (
    <div className="index-panel">
      <div className="index-search">
        <input
          type="search"
          placeholder="Filter index…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="index-search-input"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="side-empty">No matches</div>
      ) : (
        <ul className="index-list">
          {filtered.map((entry) => (
            <IndexItem key={entry.id} entry={entry} chmId={chmId} onNavigate={onNavigate} />
          ))}
        </ul>
      )}
    </div>
  )
}

function IndexItem({ entry, chmId, onNavigate }: { entry: IndexEntry; chmId: string; onNavigate: (url: string) => void }) {
  const firstLocal = entry.localPaths[0]

  const handleClick = () => {
    if (!firstLocal) return
    const path = firstLocal.startsWith('/') ? firstLocal : '/' + firstLocal
    onNavigate(`chm://${chmId}${path}`)
  }

  return (
    <li
      className={`index-item${!firstLocal ? ' index-item--no-target' : ''}`}
      style={{ paddingLeft: `${entry.depth * 16 + 8}px` }}
      onClick={handleClick}
      role={firstLocal ? 'button' : undefined}
      tabIndex={firstLocal ? 0 : undefined}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && firstLocal) handleClick() }}
    >
      {entry.name || '(untitled)'}
      {entry.localPaths.length > 1 && (
        <span className="index-item-count">{entry.localPaths.length}</span>
      )}
    </li>
  )
}
