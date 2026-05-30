import { protocol } from 'electron'
import { getSession } from './chm-session'
import { isSafeInternalPath, mimeTypeForPath } from '../core/chm/mime'

export const CHM_SCHEME = 'chm'

// Must be called synchronously before app.whenReady() —
// Electron requires scheme registration before the app is ready.
export function registerChmScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CHM_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: false,
        stream: true
      }
    }
  ])
}

/**
 * Called after app is ready. Handles chm://<chmId>/internal/path requests.
 *
 * URL anatomy:
 *   chm://550e8400-e29b-41d4-a716-446655440000/some/page.htm
 *         └── chmId (UUID) ──────────────────┘ └─ internal path ─┘
 *
 * Chromium resolves relative links (images, CSS, hrefs) against this base,
 * so the chmId is preserved automatically for all assets on a page.
 *
 * Security:
 *   - Reject any path segment containing ".." (traversal).
 *   - Path is resolved entirely within the CHM; it never touches the filesystem.
 *   - Unknown chmId → 404 (no information about filesystem layout exposed).
 */
export function installChmProtocolHandler(): void {
  protocol.handle(CHM_SCHEME, (request) => {
    try {
      const url = new URL(request.url)
      const chmId = url.hostname
      // pathname starts with "/"; strip it to get the CHM-internal path.
      const internalPath = decodeURIComponent(url.pathname)

      if (!isSafeInternalPath(internalPath)) {
        return new Response('Forbidden', { status: 403 })
      }

      const session = getSession(chmId)
      if (!session) {
        return new Response('CHM session not found', { status: 404 })
      }

      let bytes: Uint8Array
      try {
        bytes = session.chm.read(internalPath)
      } catch {
        return new Response('Not found', { status: 404 })
      }

      return new Response(bytes, {
        status: 200,
        headers: { 'Content-Type': mimeTypeForPath(internalPath) }
      })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}
