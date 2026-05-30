import { describe, it, expect } from 'vitest'
import { BufferReader } from '@core/chm/buffer-reader'
import { parseItsfHeader } from '@core/chm/itsf'
import { parseItspHeader, parsePmglHeader, parsePmgiHeader } from '@core/chm/directory'
import { parseLzxcControlData, parseLzxcResetTable } from '@core/chm/lzx'

describe('BufferReader', () => {
  it('reads little-endian integers', () => {
    const r = new BufferReader(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff]))
    expect(r.readUint32LE()).toBe(1)
    expect(r.readInt32LE()).toBe(-1)
  })

  it('decodes single-byte ENCINT', () => {
    expect(new BufferReader(new Uint8Array([0x05])).readEncint()).toBe(5n)
    expect(new BufferReader(new Uint8Array([0x7f])).readEncint()).toBe(127n)
  })

  it('decodes multi-byte ENCINT (big-endian, 7 bits/byte)', () => {
    // 128 = 0b1000_0000 → [0x81, 0x00]
    expect(new BufferReader(new Uint8Array([0x81, 0x00])).readEncint()).toBe(128n)
    // 300 → [0x82, 0x2c]
    expect(new BufferReader(new Uint8Array([0x82, 0x2c])).readEncint()).toBe(300n)
  })

  it('throws when reading past the end', () => {
    expect(() => new BufferReader(new Uint8Array([0x01])).readUint32LE()).toThrow(/past end/)
  })

  it('reads ASCII and skips', () => {
    const r = new BufferReader(new Uint8Array([0x49, 0x54, 0x53, 0x46, 0xaa]))
    expect(r.readAscii(4)).toBe('ITSF')
    r.skip(1)
    expect(r.remaining).toBe(0)
  })
})

/** Build a minimal ITSF header buffer for tests. */
function makeItsf(version: number, len: number): Uint8Array {
  const buf = new Uint8Array(len)
  const dv = new DataView(buf.buffer)
  buf.set([0x49, 0x54, 0x53, 0x46], 0) // "ITSF"
  dv.setInt32(0x04, version, true)
  dv.setInt32(0x08, len, true)
  dv.setBigUint64(0x48, 0x1000n, true) // dirOffset
  dv.setBigUint64(0x50, 0x200n, true) // dirLen
  if (version === 3) dv.setBigUint64(0x58, 0x3000n, true) // dataOffset
  return buf
}

describe('parseItsfHeader', () => {
  it('parses a v3 header with explicit dataOffset', () => {
    const h = parseItsfHeader(makeItsf(3, 0x60))
    expect(h.version).toBe(3)
    expect(h.dirOffset).toBe(0x1000n)
    expect(h.dataOffset).toBe(0x3000n)
  })

  it('derives dataOffset for v2 (dirOffset + dirLen)', () => {
    const h = parseItsfHeader(makeItsf(2, 0x58))
    expect(h.dataOffset).toBe(0x1000n + 0x200n)
  })

  it('rejects a bad signature', () => {
    const buf = makeItsf(3, 0x60)
    buf[0] = 0x00
    expect(() => parseItsfHeader(buf)).toThrow(/bad signature/)
  })

  it('rejects an unsupported version', () => {
    expect(() => parseItsfHeader(makeItsf(9, 0x60))).toThrow(/unsupported version/)
  })
})

describe('directory header guards', () => {
  it('rejects bad ITSP/PMGL/PMGI signatures', () => {
    const bad = new Uint8Array(0x54)
    expect(() => parseItspHeader(bad)).toThrow(/bad signature/)
    expect(() => parsePmglHeader(new Uint8Array(0x14))).toThrow(/bad signature/)
    expect(() => parsePmgiHeader(new Uint8Array(0x08))).toThrow(/bad signature/)
  })
})

describe('LZXC metadata guards', () => {
  it('rejects bad control-data signature', () => {
    expect(() => parseLzxcControlData(new Uint8Array(0x18))).toThrow(/bad signature/)
  })

  it('rejects bad reset-table version', () => {
    const buf = new Uint8Array(0x28) // version field = 0 ≠ 2
    expect(() => parseLzxcResetTable(buf)).toThrow(/unsupported version/)
  })
})
