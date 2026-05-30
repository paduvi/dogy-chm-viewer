/**
 * Ported from chmlib-ts (https://github.com/dmihal/chmlib-ts), a TypeScript port
 * of CHMLib (Jed Wing) and cabextract's LZX (Stuart Caie).
 *
 * Licensed under LGPL-2.1 — see ./NOTICE.md. Keep modifications under LGPL-2.1.
 *
 * ITSF — the outermost CHM header ("Info-Tech Storage Format"). All integers
 * little-endian. Layout (v3, 0x60 bytes):
 *   0x00  char[4]  signature "ITSF"
 *   0x04  u32      version (2 or 3)
 *   0x08  u32      total header length
 *   0x0C  u32      unknown (1)
 *   0x10  u32      last-modified timestamp
 *   0x14  u32      language id
 *   0x18  guid     dir UUID (16 bytes)
 *   0x28  guid     stream UUID (16 bytes)
 *   0x38  u64      offset of header section 0 (file-size info)
 *   0x40  u64      length of header section 0
 *   0x48  u64      offset of header section 1 (the ITSP directory)
 *   0x50  u64      length of header section 1
 *   0x58  u64      offset of content section 0 (v3 only)
 */
import { BufferReader } from './buffer-reader'

export const ITSF_V2_LEN = 0x58
export const ITSF_V3_LEN = 0x60

export interface ItsfHeader {
  version: number
  /** offset of header section 1 (ITSP directory) */
  dirOffset: bigint
  /** length of header section 1 */
  dirLen: bigint
  /** start of content section 0 (where extracted data begins) */
  dataOffset: bigint
  langId: number
}

export function parseItsfHeader(data: Uint8Array): ItsfHeader {
  const r = new BufferReader(data)
  const signature = r.readAscii(4)
  if (signature !== 'ITSF') throw new Error(`ITSF: bad signature "${signature}"`)

  const version = r.readInt32LE()
  const headerLen = r.readInt32LE()
  r.skip(4) // unknown_000c
  r.skip(4) // last-modified timestamp
  const langId = r.readUint32LE()
  r.skip(16) // dir UUID
  r.skip(16) // stream UUID
  r.skip(8) // header section 0 offset (unused — file-size info)
  r.skip(8) // header section 0 length
  const dirOffset = r.readBigUint64LE()
  const dirLen = r.readBigUint64LE()

  if (version === 2) {
    if (headerLen < ITSF_V2_LEN) throw new Error(`ITSF v2 header too short: ${headerLen}`)
  } else if (version === 3) {
    if (headerLen < ITSF_V3_LEN) throw new Error(`ITSF v3 header too short: ${headerLen}`)
  } else {
    throw new Error(`ITSF: unsupported version ${version}`)
  }

  // v3 stores the content-section-0 offset explicitly; v2 implies it.
  const dataOffset = version === 3 ? r.readBigUint64LE() : dirOffset + dirLen

  return { version, dirOffset, dirLen, dataOffset, langId }
}
