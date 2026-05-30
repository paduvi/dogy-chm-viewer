// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChm, chmUrl } from '../../src/renderer/hooks/useChm'
import type { ChmDocument } from '../../src/shared/types'

// Minimal window.chm stub — the hook wires onLoadFile then calls rendererMounted on mount.
const noop = (): (() => void) => () => undefined
beforeEach(() => {
  const w = window as unknown as { chm: Record<string, unknown> }
  if (!w.chm) {
    w.chm = {
      rendererMounted: vi.fn(),
      onLoadFile: noop,
      openInNewWindow: vi.fn().mockResolvedValue(undefined),
      openChm: vi.fn(),
      getToc: vi.fn(),
      getIndex: vi.fn(),
      search: vi.fn(),
      onMenuAction: noop
    }
  } else {
    // Already set by a describe block — ensure required methods are present.
    w.chm.rendererMounted ??= vi.fn()
    w.chm.onLoadFile ??= noop
    w.chm.openInNewWindow ??= vi.fn().mockResolvedValue(undefined)
    w.chm.onMenuAction ??= noop
  }
})

describe('chmUrl', () => {
  it('builds a chm:// URL, normalising the leading slash', () => {
    expect(chmUrl('abc', 'page.htm')).toBe('chm://abc/page.htm')
    expect(chmUrl('abc', '/page.htm')).toBe('chm://abc/page.htm')
    expect(chmUrl('abc', 'dir/p.htm#frag')).toBe('chm://abc/dir/p.htm#frag')
  })
})

describe('useChm navigation history', () => {
  it('starts empty with no back/forward', () => {
    const { result } = renderHook(() => useChm())
    expect(result.current.currentUrl).toBeNull()
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(false)
  })

  it('navigate pushes entries and enables back', () => {
    const { result } = renderHook(() => useChm())
    act(() => result.current.navigate('chm://x/a.htm'))
    expect(result.current.currentUrl).toBe('chm://x/a.htm')
    expect(result.current.canGoBack).toBe(false) // only one entry

    act(() => result.current.navigate('chm://x/b.htm'))
    expect(result.current.currentUrl).toBe('chm://x/b.htm')
    expect(result.current.canGoBack).toBe(true)
    expect(result.current.canGoForward).toBe(false)
  })

  it('back and forward move through history', () => {
    const { result } = renderHook(() => useChm())
    act(() => result.current.navigate('chm://x/a.htm'))
    act(() => result.current.navigate('chm://x/b.htm'))

    act(() => result.current.back())
    expect(result.current.currentUrl).toBe('chm://x/a.htm')
    expect(result.current.canGoBack).toBe(false)
    expect(result.current.canGoForward).toBe(true)

    act(() => result.current.forward())
    expect(result.current.currentUrl).toBe('chm://x/b.htm')
    expect(result.current.canGoForward).toBe(false)
  })

  it('ignores echo navigations to the current URL (no duplicate entries)', () => {
    // Regression: the webview confirms each navigation via did-navigate, which
    // calls navigate() again with the same URL. That echo must NOT create a
    // duplicate history entry, or Back would appear to do nothing.
    const { result } = renderHook(() => useChm())
    act(() => result.current.navigate('chm://x/a.htm'))
    act(() => result.current.navigate('chm://x/b.htm'))
    act(() => result.current.navigate('chm://x/b.htm')) // echo

    // Back should land on A, proving the echo was not pushed.
    act(() => result.current.back())
    expect(result.current.currentUrl).toBe('chm://x/a.htm')
    expect(result.current.canGoBack).toBe(false)
  })

  it('truncates forward history when navigating from a back position', () => {
    const { result } = renderHook(() => useChm())
    act(() => result.current.navigate('chm://x/a.htm'))
    act(() => result.current.navigate('chm://x/b.htm'))
    act(() => result.current.navigate('chm://x/c.htm'))
    act(() => result.current.back()) // now at b, forward → c
    expect(result.current.canGoForward).toBe(true)

    act(() => result.current.navigate('chm://x/d.htm')) // diverge
    expect(result.current.currentUrl).toBe('chm://x/d.htm')
    expect(result.current.canGoForward).toBe(false) // c was dropped

    act(() => result.current.back())
    expect(result.current.currentUrl).toBe('chm://x/b.htm')
  })

  it('back/forward are no-ops at the ends of history', () => {
    const { result } = renderHook(() => useChm())
    act(() => result.current.navigate('chm://x/a.htm'))
    act(() => result.current.back()) // nothing before
    expect(result.current.currentUrl).toBe('chm://x/a.htm')
    act(() => result.current.forward()) // nothing after
    expect(result.current.currentUrl).toBe('chm://x/a.htm')
  })
})

// ── Pending-file loading (replaces the old openChm() dialog flow) ─────────────
//
// Main queues a file path for the window before the renderer mounts.
// The hook calls window.chm.getPendingFile() on mount; if a path is returned
// it immediately loads the CHM via window.chm.openChm().

type ChmApiMock = {
  rendererMounted: ReturnType<typeof vi.fn>
  onLoadFile: ReturnType<typeof vi.fn>
  openInNewWindow: ReturnType<typeof vi.fn>
  openChm: ReturnType<typeof vi.fn>
  getToc: ReturnType<typeof vi.fn>
  getIndex: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
}

describe('useChm LOAD_FILE push (new-window flow)', () => {
  const doc: ChmDocument = {
    chmId: 'doc-1',
    filePath: '/tmp/help.chm',
    title: 'help',
    toc: [{ id: 't0', name: 'Intro', localPath: 'intro.htm', children: [] }],
    index: []
  }

  let chm: ChmApiMock

  beforeEach(() => {
    chm = {
      rendererMounted: vi.fn(),
      onLoadFile: vi.fn().mockReturnValue(() => undefined), // default: no-op subscription
      openInNewWindow: vi.fn().mockResolvedValue(undefined),
      openChm: vi.fn().mockResolvedValue({ ok: true, value: doc }),
      getToc: vi.fn(),
      getIndex: vi.fn(),
      search: vi.fn()
    }
    const w = window as unknown as { chm: ChmApiMock & { onMenuAction: () => () => void } }
    w.chm = { ...chm, onMenuAction: () => () => undefined }
  })

  it('calls rendererMounted on mount so main knows the listener is ready', () => {
    renderHook(() => useChm())
    expect(chm.rendererMounted).toHaveBeenCalledOnce()
  })

  it('opens a file when main pushes LOAD_FILE after receiving RENDERER_MOUNTED', async () => {
    // Simulate the new-window flow: onLoadFile captures the handler (registered
    // before rendererMounted is called), then main pushes the file path.
    let capturedHandler: ((fp: string) => void) | null = null
    chm.onLoadFile.mockImplementation((handler: (fp: string) => void) => {
      capturedHandler = handler
      return () => undefined
    })

    const { result } = renderHook(() => useChm())
    await act(async () => { await Promise.resolve() })

    // Simulate main's RENDERER_MOUNTED handler pushing the queued file.
    await act(async () => {
      capturedHandler?.('/tmp/new-window.chm')
      await Promise.resolve()
    })

    expect(chm.openChm).toHaveBeenCalledWith('/tmp/new-window.chm')
    expect(result.current.doc?.chmId).toBe('doc-1')
    expect(result.current.currentUrl).toBe('chm://doc-1/intro.htm')
    expect(result.current.error).toBeNull()
  })

  it('opens a file when main pushes LOAD_FILE for drag-drop on an existing window', async () => {
    let capturedHandler: ((fp: string) => void) | null = null
    chm.onLoadFile.mockImplementation((handler: (fp: string) => void) => {
      capturedHandler = handler
      return () => undefined
    })

    const { result } = renderHook(() => useChm())
    await act(async () => { await Promise.resolve() })

    await act(async () => {
      capturedHandler?.('/tmp/dragged.chm')
      await Promise.resolve()
    })

    expect(chm.openChm).toHaveBeenCalledWith('/tmp/dragged.chm')
    expect(result.current.doc?.chmId).toBe('doc-1')
    expect(result.current.currentUrl).toBe('chm://doc-1/intro.htm')
  })

  it('surfaces an error when openChm fails', async () => {
    let capturedHandler: ((fp: string) => void) | null = null
    chm.onLoadFile.mockImplementation((handler: (fp: string) => void) => {
      capturedHandler = handler
      return () => undefined
    })
    chm.openChm.mockResolvedValueOnce({ ok: false, error: 'boom' })

    const { result } = renderHook(() => useChm())
    await act(async () => { await Promise.resolve() })
    await act(async () => {
      capturedHandler?.('/tmp/bad.chm')
      await Promise.resolve()
    })

    expect(result.current.error).toBe('boom')
    expect(result.current.doc).toBeNull()
  })

  it('does nothing when no file is pushed (normal empty-window launch)', async () => {
    // rendererMounted fires but main has no pending file → no LOAD_FILE push.
    const { result } = renderHook(() => useChm())
    await act(async () => { await Promise.resolve() })
    expect(chm.openChm).not.toHaveBeenCalled()
    expect(result.current.doc).toBeNull()
    expect(result.current.currentUrl).toBeNull()
  })
})
