/**
 * Tolerant tokenizer for CHM sitemap files (.hhc TOC and .hhk index).
 *
 * These are loose, often-malformed HTML: nested <ul> with frequently unclosed
 * <li>, and <object type="text/sitemap"> blocks holding <param name= value=>.
 * A strict DOM parser would choke, so we scan only the tags that matter and
 * rebuild the tree from <ul> nesting. Original code (not derived from chmlib).
 */

export interface SitemapNode {
  /** first "Name" param — the display label */
  name: string
  /** every "Local" param value, in document order (targets to jump to) */
  locals: string[]
  children: SitemapNode[]
}

interface Frame {
  list: SitemapNode[]
  last: SitemapNode | null
}

// One pass over the relevant tags in document order.
const TOKEN_RE = /<ul\b[^>]*>|<\/ul\s*>|<object\b([^>]*)>|<\/object\s*>|<param\b([^>]*)>/gi

const ATTR_RE = (name: string): RegExp =>
  new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')

const TYPE_ATTR = ATTR_RE('type')
const NAME_ATTR = ATTR_RE('name')
const VALUE_ATTR = ATTR_RE('value')

function attr(re: RegExp, attrs: string): string | null {
  const m = re.exec(attrs)
  if (!m) return null
  return m[1] ?? m[2] ?? ''
}

export function parseSitemap(content: string): SitemapNode[] {
  const root: SitemapNode[] = []
  const stack: Frame[] = [{ list: root, last: null }]
  let cur: SitemapNode | null = null // object currently being collected

  const top = (): Frame => stack[stack.length - 1]

  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(content)) !== null) {
    const tag = m[0]
    const lower = tag.toLowerCase()

    if (lower.startsWith('<ul')) {
      // A <ul> nests under the most recent node at the current level; the
      // outermost <ul> (no prior node) just opens the root level.
      const f = top()
      stack.push({ list: f.last ? f.last.children : f.list, last: null })
    } else if (lower.startsWith('</ul')) {
      if (stack.length > 1) stack.pop()
    } else if (lower.startsWith('<object')) {
      const type = attr(TYPE_ATTR, m[1] ?? '')
      cur = type && type.toLowerCase().includes('sitemap') ? { name: '', locals: [], children: [] } : null
    } else if (lower.startsWith('</object')) {
      if (cur) {
        const f = top()
        f.list.push(cur)
        f.last = cur
        cur = null
      }
    } else if (lower.startsWith('<param') && cur) {
      const pname = (attr(NAME_ATTR, m[2] ?? '') ?? '').toLowerCase()
      const value = attr(VALUE_ATTR, m[2] ?? '')
      if (value === null) continue
      if (pname === 'name') {
        if (cur.name === '') cur.name = decodeEntities(value)
      } else if (pname === 'local') {
        cur.locals.push(decodeEntities(value))
      }
    }
  }

  return root
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

/** Decode the HTML entities that appear in sitemap param values. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}
