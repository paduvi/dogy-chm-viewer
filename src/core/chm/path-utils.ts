/**
 * Tiny path helpers for CHM internal paths. Deliberately free of node:path so
 * the core stays portable (Node, tests, and a browser/worker for search later).
 * Original code (not chmlib).
 */

/** Last path segment, e.g. "/a/b/c.htm" → "c.htm". Works for OS and CHM paths. */
export function basename(path: string): string {
  const norm = path.replace(/\\/g, '/')
  const trimmed = norm.endsWith('/') ? norm.slice(0, -1) : norm
  const idx = trimmed.lastIndexOf('/')
  return idx === -1 ? trimmed : trimmed.slice(idx + 1)
}

/** Strip a trailing #fragment from a CHM Local value → the bare internal path. */
export function stripFragment(local: string): string {
  const hash = local.indexOf('#')
  return hash === -1 ? local : local.slice(0, hash)
}
