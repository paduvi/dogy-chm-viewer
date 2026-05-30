/**
 * MIME type lookup + path-safety for serving CHM internal files. Pure (no
 * Electron/Node), so it is unit-testable in isolation. Original code.
 */

const MIME_MAP: Record<string, string> = {
  htm: 'text/html; charset=windows-1252',
  html: 'text/html; charset=windows-1252',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  xml: 'application/xml',
  svg: 'image/svg+xml',
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf'
}

export function mimeTypeForPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? ''
  return MIME_MAP[ext] ?? 'application/octet-stream'
}

/**
 * Reject internal paths that could escape the CHM root. A safe path starts with
 * "/" and contains no ".." segment after splitting on "/". The CHM reader never
 * touches the real filesystem, but this is defence-in-depth at the boundary.
 */
export function isSafeInternalPath(path: string): boolean {
  if (!path.startsWith('/')) return false
  return path.split('/').every((seg) => seg !== '..')
}
