import { useState, useEffect, useRef } from 'react'
import type { SearchResult } from '../../shared/types'

interface SearchPanelProps {
  chmId: string
  onNavigate: (url: string) => void
}

type Status = 'idle' | 'searching' | 'done' | 'error'

export function SearchPanel({ chmId, onNavigate }: SearchPanelProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounce queries; the first one may take ~1 s while the index builds.
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults([])
      setStatus('idle')
      return
    }
    let cancelled = false
    setStatus('searching')
    const timer = setTimeout(() => {
      void window.chm.search(chmId, q).then((res) => {
        if (cancelled) return
        if (res.ok) {
          setResults(res.value)
          setStatus('done')
          setError(null)
        } else {
          setError(res.error)
          setStatus('error')
        }
      })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, chmId])

  return (
    <div className="search-panel">
      <div className="search-box">
        <input
          ref={inputRef}
          type="search"
          placeholder="Search all pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="search-input"
        />
      </div>

      {status === 'searching' && <div className="side-empty">Searching…</div>}
      {status === 'error' && <div className="side-empty">Search failed: {error}</div>}
      {status === 'done' && results.length === 0 && <div className="side-empty">No results</div>}

      {results.length > 0 && (
        <ul className="search-results">
          {results.map((r) => (
            <li
              key={r.id}
              className="search-result"
              role="button"
              tabIndex={0}
              onClick={() => onNavigate(toUrl(chmId, r.localPath))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onNavigate(toUrl(chmId, r.localPath))
              }}
            >
              <div className="search-result-title">{r.title}</div>
              <div className="search-result-excerpt">{r.excerpt}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function toUrl(chmId: string, localPath: string): string {
  const path = localPath.startsWith('/') ? localPath : '/' + localPath
  return `chm://${chmId}${path}`
}
