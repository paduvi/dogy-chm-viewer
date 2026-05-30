import { describe, it, expect } from 'vitest'
import { mimeTypeForPath, isSafeInternalPath } from '@core/chm/mime'

describe('mimeTypeForPath', () => {
  it('maps common CHM asset extensions', () => {
    expect(mimeTypeForPath('/page.htm')).toBe('text/html; charset=windows-1252')
    expect(mimeTypeForPath('/a/b/page.HTML')).toBe('text/html; charset=windows-1252')
    expect(mimeTypeForPath('/style.css')).toBe('text/css')
    expect(mimeTypeForPath('/img/logo.gif')).toBe('image/gif')
    expect(mimeTypeForPath('/img/photo.JPG')).toBe('image/jpeg')
    expect(mimeTypeForPath('/icon.png')).toBe('image/png')
  })

  it('falls back to octet-stream for unknown/extensionless paths', () => {
    expect(mimeTypeForPath('/data.bin')).toBe('application/octet-stream')
    expect(mimeTypeForPath('/#SYSTEM')).toBe('application/octet-stream')
    expect(mimeTypeForPath('/noext')).toBe('application/octet-stream')
  })
})

describe('isSafeInternalPath', () => {
  it('accepts normal absolute internal paths', () => {
    expect(isSafeInternalPath('/index.htm')).toBe(true)
    expect(isSafeInternalPath('/tables/OVR.html')).toBe(true)
    expect(isSafeInternalPath('/#SYSTEM')).toBe(true)
    expect(isSafeInternalPath('/a/b/c/d.gif')).toBe(true)
  })

  it('rejects traversal and non-absolute paths', () => {
    expect(isSafeInternalPath('/../etc/passwd')).toBe(false)
    expect(isSafeInternalPath('/a/../../b')).toBe(false)
    expect(isSafeInternalPath('/foo/..')).toBe(false)
    expect(isSafeInternalPath('relative/path.htm')).toBe(false)
    expect(isSafeInternalPath('')).toBe(false)
  })

  it('does not reject filenames that merely contain dots', () => {
    expect(isSafeInternalPath('/a..b/file.htm')).toBe(true)
    expect(isSafeInternalPath('/version.2.0.htm')).toBe(true)
  })
})
