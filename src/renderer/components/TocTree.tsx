import { useState } from 'react'
import type { TocNode } from '../../shared/types'

interface TocTreeProps {
  nodes: TocNode[]
  currentUrl: string | null
  chmId: string
  onNavigate: (url: string) => void
}

export function TocTree({ nodes, currentUrl, chmId, onNavigate }: TocTreeProps) {
  if (nodes.length === 0) return <div className="side-empty">No table of contents</div>
  return (
    <ul className="toc-list">
      {nodes.map((node) => (
        <TocItem
          key={node.id}
          node={node}
          depth={0}
          currentUrl={currentUrl}
          chmId={chmId}
          onNavigate={onNavigate}
        />
      ))}
    </ul>
  )
}

interface TocItemProps {
  node: TocNode
  depth: number
  currentUrl: string | null
  chmId: string
  onNavigate: (url: string) => void
}

function TocItem({ node, depth, currentUrl, chmId, onNavigate }: TocItemProps) {
  // Expand top-level items by default; collapse deeper ones.
  const [expanded, setExpanded] = useState(depth === 0)
  const hasChildren = node.children.length > 0

  const url = node.localPath ? `chm://${chmId}${node.localPath.startsWith('/') ? '' : '/'}${node.localPath}` : null
  const isActive = url !== null && currentUrl !== null && currentUrl.split('#')[0] === url.split('#')[0]

  const handleClick = () => {
    if (url) onNavigate(url)
    if (hasChildren) setExpanded((e) => !e)
  }

  return (
    <li className="toc-item">
      <div
        className={`toc-row${isActive ? ' toc-row--active' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        onClick={handleClick}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleClick() }}
      >
        <span className={`toc-arrow${hasChildren ? '' : ' toc-arrow--hidden'}`}>
          {expanded ? '▾' : '▸'}
        </span>
        <span className="toc-label">{node.name || '(untitled)'}</span>
      </div>
      {hasChildren && expanded && (
        <ul className="toc-list">
          {node.children.map((child) => (
            <TocItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentUrl={currentUrl}
              chmId={chmId}
              onNavigate={onNavigate}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
