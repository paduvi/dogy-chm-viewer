// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChm, chmUrl } from '../../src/renderer/hooks/useChm'
import type { ChmDocument } from '../../src/shared/types'

// Minimal window.chm stub — the hook calls onMenuAction on every mount.
const noop = (): (() => void) => () => undefined
beforeEach(() => {
  const w = window as unknown as { chm: Record<string, unknown> }
  if (!w.chm) {
    w.chm = {
      openDialog: vi.fn(),
      openChm: vi.fn(),
      getToc: vi.fn(),
      getIndex: vi.fn(),
      search: vi.fn(),
      onMenuAction: noop
    }
  } else {
    // Already set by a describe block — just ensure onMenuAction is present.
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

type ChmApiMock = {
  openDialog: ReturnType<typeof vi.fn>
  openChm: ReturnType<typeof vi.fn>
  getToc: ReturnType<typeof vi.fn>
  getIndex: ReturnType<typeof vi.fn>
  search: ReturnType<typeof vi.fn>
}

describe('useChm.openChm', () => {
  const doc: ChmDocument = {
    chmId: 'doc-1',
    filePath: '/tmp/help.chm',
    title: 'help',
    toc: [{ id: 't0', name: 'Intro', localPath: 'intro.htm', children: [] }],
    index: []
  }

  let chm: ChmApiMock

  beforeEach(() => {
    // Stub the preload bridge (window.chm) that openChm calls.
    chm = {
      openDialog: vi.fn().mockResolvedValue({ ok: true, value: '/tmp/help.chm' }),
      openChm: vi.fn().mockResolvedValue({ ok: true, value: doc }),
      getToc: vi.fn(),
      getIndex: vi.fn(),
      search: vi.fn()
    }
    const w = window as unknown as { chm: ChmApiMock & { onMenuAction: () => () => void } }
    w.chm = { ...chm, onMenuAction: () => () => undefined }
  })

  it('loads the document and navigates to the first TOC entry', async () => {
    const { result } = renderHook(() => useChm())
    await act(async () => {
      await result.current.openChm()
    })
    expect(result.current.doc?.chmId).toBe('doc-1')
    expect(result.current.currentUrl).toBe('chm://doc-1/intro.htm')
    expect(result.current.error).toBeNull()
  })

  it('surfaces an error when openChm fails', async () => {
    chm.openChm.mockResolvedValueOnce({ ok: false, error: 'boom' })
    const { result } = renderHook(() => useChm())
    await act(async () => {
      await result.current.openChm()
    })
    expect(result.current.error).toBe('boom')
    expect(result.current.doc).toBeNull()
  })

  it('does nothing when the dialog is cancelled', async () => {
    chm.openDialog.mockResolvedValueOnce({ ok: true, value: null })
    const { result } = renderHook(() => useChm())
    await act(async () => {
      await result.current.openChm()
    })
    expect(result.current.doc).toBeNull()
    expect(result.current.currentUrl).toBeNull()
  })
})
