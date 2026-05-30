import { describe, it, expect } from 'vitest'
import { ChmFile } from '@core/chm/chm-file'

describe('ChmFile (Phase 0 smoke)', () => {
  it('throws if read() is called before open()', () => {
    const f = new ChmFile()
    expect(() => f.read('/index.htm')).toThrow('call open() first')
  })

  it('throws if list() is called before open()', () => {
    const f = new ChmFile()
    expect(() => f.list()).toThrow('call open() first')
  })

  it('close() is idempotent', () => {
    const f = new ChmFile()
    expect(() => f.close()).not.toThrow()
    expect(() => f.close()).not.toThrow()
  })
})
