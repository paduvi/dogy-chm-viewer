/**
 * Ported from chmlib-ts (https://github.com/dmihal/chmlib-ts), a TypeScript port
 * of CHMLib (Jed Wing) and cabextract's LZX (Stuart Caie).
 *
 * Licensed under LGPL-2.1 — see ./NOTICE.md. Keep modifications under LGPL-2.1.
 *
 * LZX decompression — LZ77 + Huffman, the compression CHM uses. Includes the
 * Intel E8 CALL-instruction translation (a wrong implementation silently
 * corrupts any output frame containing byte 0xE8). Plus the LZXC ControlData
 * and ResetTable parsers that supply the window size and random-access bounds.
 */
import { BufferReader } from './buffer-reader'

// --- LZXC metadata (window size + random-access reset table) ---

export interface LzxcControlData {
  resetInterval: number
  windowSize: number
  windowsPerReset: number
}

const LZXC_MIN_LEN = 0x18

export function parseLzxcControlData(data: Uint8Array): LzxcControlData {
  if (data.length < LZXC_MIN_LEN) throw new Error(`LZXC control data: too short (${data.length})`)
  const r = new BufferReader(data)
  r.readUint32LE() // size (count of dwords following)
  const signature = r.readAscii(4)
  if (signature !== 'LZXC') throw new Error(`LZXC control data: bad signature "${signature}"`)
  const version = r.readUint32LE()
  let resetInterval = r.readUint32LE()
  let windowSize = r.readUint32LE()
  const windowsPerReset = r.readUint32LE()

  // v2/v3 express reset interval and window size in units of 0x8000 bytes.
  if (version === 2) {
    resetInterval *= 0x8000
    windowSize *= 0x8000
  }

  if (windowSize === 0 || resetInterval === 0) throw new Error('LZXC: zero windowSize or resetInterval')
  if (windowSize === 1) throw new Error('LZXC: windowSize is 1')
  if (resetInterval % (windowSize / 2) !== 0) {
    throw new Error('LZXC: resetInterval not a multiple of windowSize/2')
  }

  return { resetInterval, windowSize, windowsPerReset }
}

export interface LzxcResetTable {
  blockCount: number
  /** offset within the ResetTable file where the per-block offset array begins */
  tableOffset: number
  uncompressedLen: bigint
  compressedLen: bigint
  /** size of each decompressed block (the reset interval, in bytes) */
  blockLen: bigint
}

export const LZXC_RESET_TABLE_LEN = 0x28

export function parseLzxcResetTable(data: Uint8Array): LzxcResetTable {
  if (data.length < LZXC_RESET_TABLE_LEN) {
    throw new Error(`LZXC reset table: too short (${data.length})`)
  }
  const r = new BufferReader(data)
  const version = r.readUint32LE()
  if (version !== 2) throw new Error(`LZXC reset table: unsupported version ${version}`)
  const blockCount = r.readUint32LE()
  r.readUint32LE() // unknown (entry size)
  const tableOffset = r.readUint32LE()
  const uncompressedLen = r.readBigUint64LE()
  const compressedLen = r.readBigUint64LE()
  const blockLen = r.readBigUint64LE()
  return { blockCount, tableOffset, uncompressedLen, compressedLen, blockLen }
}

// --- LZX decoder ---

const LZX_MIN_MATCH = 2
const LZX_NUM_CHARS = 256
const LZX_BLOCKTYPE_VERBATIM = 1
const LZX_BLOCKTYPE_ALIGNED = 2
const LZX_BLOCKTYPE_UNCOMPRESSED = 3
const LZX_PRETREE_NUM_ELEMENTS = 20
const LZX_NUM_PRIMARY_LENGTHS = 7
const LZX_NUM_SECONDARY_LENGTHS = 249

const LZX_PRETREE_TABLEBITS = 6
const LZX_PRETREE_MAXSYMBOLS = LZX_PRETREE_NUM_ELEMENTS
const LZX_MAINTREE_TABLEBITS = 12
const LZX_MAINTREE_MAXSYMBOLS = LZX_NUM_CHARS + 50 * 8
const LZX_LENGTH_TABLEBITS = 12
const LZX_LENGTH_MAXSYMBOLS = LZX_NUM_SECONDARY_LENGTHS + 1
const LZX_ALIGNED_TABLEBITS = 7
const LZX_ALIGNED_MAXSYMBOLS = 8
const LZX_LENTABLE_SAFETY = 64

const ULONG_BITS = 32

const EXTRA_BITS = new Uint8Array([
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
  14, 14, 15, 15, 16, 16, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17
])

const POSITION_BASE = new Uint32Array([
  0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024, 1536, 2048,
  3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 196608, 262144,
  393216, 524288, 655360, 786432, 917504, 1048576, 1179648, 1310720, 1441792, 1572864, 1703936,
  1835008, 1966080, 2097152
])

/** Build a Huffman decode table from code lengths. Returns 0 on success, 1 on error. */
function makeDecodeTable(nsyms: number, nbits: number, length: Uint8Array, table: Uint16Array): number {
  let leaf: number
  let bitNum = 1
  let pos = 0
  let tableMask = 1 << nbits
  let bitMask = tableMask >> 1
  let nextSymbol = bitMask

  while (bitNum <= nbits) {
    for (let sym = 0; sym < nsyms; sym++) {
      if (length[sym] === bitNum) {
        leaf = pos
        if ((pos += bitMask) > tableMask) return 1
        let fill = bitMask
        while (fill-- > 0) table[leaf++] = sym
      }
    }
    bitMask >>= 1
    bitNum++
  }

  if (pos !== tableMask) {
    for (let sym = pos; sym < tableMask; sym++) table[sym] = 0

    pos <<= 16
    tableMask <<= 16
    bitMask = 1 << 15

    while (bitNum <= 16) {
      for (let sym = 0; sym < nsyms; sym++) {
        if (length[sym] === bitNum) {
          leaf = pos >> 16
          for (let fill = 0; fill < bitNum - nbits; fill++) {
            if (table[leaf] === 0) {
              table[nextSymbol << 1] = 0
              table[(nextSymbol << 1) + 1] = 0
              table[leaf] = nextSymbol++
            }
            leaf = table[leaf] << 1
            if ((pos >> (15 - fill)) & 1) leaf++
          }
          table[leaf] = sym
          if ((pos += bitMask) > tableMask) return 1
        }
      }
      bitMask >>= 1
      bitNum++
    }
  }

  if (pos === tableMask) return 0
  for (let sym = 0; sym < nsyms; sym++) if (length[sym]) return 1
  return 0
}

export class LZXState {
  window: Uint8Array
  windowSize: number
  windowPosn: number
  R0: number
  R1: number
  R2: number
  mainElements: number
  headerRead: boolean
  blockType: number
  blockLength: number
  blockRemaining: number
  framesRead: number
  intelFilesize: number
  intelCurpos: number
  intelStarted: boolean

  PRETREE_table: Uint16Array
  PRETREE_len: Uint8Array
  MAINTREE_table: Uint16Array
  MAINTREE_len: Uint8Array
  LENGTH_table: Uint16Array
  LENGTH_len: Uint8Array
  ALIGNED_table: Uint16Array
  ALIGNED_len: Uint8Array

  constructor(windowBits: number) {
    if (windowBits < 15 || windowBits > 21) {
      throw new RangeError(`LZXState: invalid window bits ${windowBits} (must be 15-21)`)
    }

    const wndsize = 1 << windowBits
    let posnSlots: number
    if (windowBits === 20) posnSlots = 42
    else if (windowBits === 21) posnSlots = 50
    else posnSlots = windowBits << 1

    this.window = new Uint8Array(wndsize)
    this.windowSize = wndsize
    this.windowPosn = 0
    this.R0 = this.R1 = this.R2 = 1
    this.mainElements = LZX_NUM_CHARS + (posnSlots << 3)
    this.headerRead = false
    this.framesRead = 0
    this.blockRemaining = 0
    this.blockType = 0
    this.blockLength = 0
    this.intelCurpos = 0
    this.intelStarted = false
    this.intelFilesize = 0

    this.PRETREE_table = new Uint16Array((1 << LZX_PRETREE_TABLEBITS) + (LZX_PRETREE_MAXSYMBOLS << 1))
    this.PRETREE_len = new Uint8Array(LZX_PRETREE_MAXSYMBOLS + LZX_LENTABLE_SAFETY)
    this.MAINTREE_table = new Uint16Array((1 << LZX_MAINTREE_TABLEBITS) + (LZX_MAINTREE_MAXSYMBOLS << 1))
    this.MAINTREE_len = new Uint8Array(LZX_MAINTREE_MAXSYMBOLS + LZX_LENTABLE_SAFETY)
    this.LENGTH_table = new Uint16Array((1 << LZX_LENGTH_TABLEBITS) + (LZX_LENGTH_MAXSYMBOLS << 1))
    this.LENGTH_len = new Uint8Array(LZX_LENGTH_MAXSYMBOLS + LZX_LENTABLE_SAFETY)
    this.ALIGNED_table = new Uint16Array((1 << LZX_ALIGNED_TABLEBITS) + (LZX_ALIGNED_MAXSYMBOLS << 1))
    this.ALIGNED_len = new Uint8Array(LZX_ALIGNED_MAXSYMBOLS + LZX_LENTABLE_SAFETY)
  }

  /** Reset decoder state at a reset-interval boundary (enables random access). */
  reset(): void {
    this.R0 = this.R1 = this.R2 = 1
    this.headerRead = false
    this.framesRead = 0
    this.blockRemaining = 0
    this.blockType = 0
    this.intelCurpos = 0
    this.intelStarted = false
    this.windowPosn = 0
    this.MAINTREE_len.fill(0)
    this.LENGTH_len.fill(0)
  }
}

export const DECR_OK = 0
export const DECR_DATAFORMAT = 1
export const DECR_ILLEGALDATA = 2

/** Decompress one LZX block. Returns DECR_OK on success. */
export function lzxDecompress(
  state: LZXState,
  inData: Uint8Array,
  outData: Uint8Array,
  inLen: number,
  outLen: number
): number {
  const window = state.window
  const windowSize = state.windowSize

  let windowPosn = state.windowPosn
  let R0 = state.R0
  let R1 = state.R1
  let R2 = state.R2

  // 32-bit bitbuf filled from the MSB, 16 bits (one LE word) at a time.
  let bitbuf = 0
  let bitsleft = 0
  let inpos = 0
  const endinp = inLen

  function ensureBits(n: number): void {
    while (bitsleft < n) {
      const lo = inpos < inLen ? inData[inpos] : 0
      const hi = inpos + 1 < inLen ? inData[inpos + 1] : 0
      bitbuf = (bitbuf | (((hi << 8) | lo) << (ULONG_BITS - 16 - bitsleft))) >>> 0
      bitsleft += 16
      inpos += 2
    }
  }

  function peekBits(n: number): number {
    return (bitbuf >>> (ULONG_BITS - n)) >>> 0
  }

  function removeBits(n: number): void {
    bitbuf = (bitbuf << n) >>> 0
    bitsleft -= n
  }

  function readBits(n: number): number {
    ensureBits(n)
    const v = peekBits(n)
    removeBits(n)
    return v
  }

  function readHuffSym(table: Uint16Array, len: Uint8Array, tablebits: number, maxsyms: number): number {
    ensureBits(16)
    let i = table[peekBits(tablebits)]
    if (i >= maxsyms) {
      let j = 1 << (ULONG_BITS - tablebits)
      do {
        j >>>= 1
        i <<= 1
        i |= bitbuf & j ? 1 : 0
        if (!j) return -1
        i = table[i]
      } while (i >= maxsyms)
    }
    removeBits(len[i])
    return i
  }

  // Pretree-coded code lengths for [first..last). Pretree lens go into PRETREE_len.
  function readLengths(lens: Uint8Array, first: number, last: number): boolean {
    for (let x = 0; x < 20; x++) state.PRETREE_len[x] = readBits(4)
    if (makeDecodeTable(LZX_PRETREE_MAXSYMBOLS, LZX_PRETREE_TABLEBITS, state.PRETREE_len, state.PRETREE_table)) {
      return true
    }

    let x = first
    while (x < last) {
      const z = readHuffSym(state.PRETREE_table, state.PRETREE_len, LZX_PRETREE_TABLEBITS, LZX_PRETREE_MAXSYMBOLS)
      if (z < 0) return true

      if (z === 17) {
        let y = readBits(4) + 4
        while (y-- > 0) lens[x++] = 0
      } else if (z === 18) {
        let y = readBits(5) + 20
        while (y-- > 0) lens[x++] = 0
      } else if (z === 19) {
        let y = readBits(1) + 4
        const zz = readHuffSym(state.PRETREE_table, state.PRETREE_len, LZX_PRETREE_TABLEBITS, LZX_PRETREE_MAXSYMBOLS)
        if (zz < 0) return true
        let val = lens[x] - zz
        if (val < 0) val += 17
        while (y-- > 0) lens[x++] = val
      } else {
        let val = lens[x] - z
        if (val < 0) val += 17
        lens[x++] = val
      }
    }
    return false
  }

  let togo = outLen

  if (!state.headerRead) {
    let i = 0
    let j = 0
    if (readBits(1)) {
      i = readBits(16)
      j = readBits(16)
    }
    state.intelFilesize = (i << 16) | j
    state.headerRead = true
  }

  while (togo > 0) {
    if (state.blockRemaining === 0) {
      if (state.blockType === LZX_BLOCKTYPE_UNCOMPRESSED) {
        if (state.blockLength & 1) inpos++ // realign to word boundary
        bitsleft = 0
        bitbuf = 0
      }

      state.blockType = readBits(3)
      const i16 = readBits(16)
      const j8 = readBits(8)
      state.blockRemaining = state.blockLength = (i16 << 8) | j8

      switch (state.blockType) {
        case LZX_BLOCKTYPE_ALIGNED:
          for (let i = 0; i < 8; i++) state.ALIGNED_len[i] = readBits(3)
          if (makeDecodeTable(LZX_ALIGNED_MAXSYMBOLS, LZX_ALIGNED_TABLEBITS, state.ALIGNED_len, state.ALIGNED_table)) {
            return DECR_ILLEGALDATA
          }
        // falls through — aligned blocks also read the main and length trees
        case LZX_BLOCKTYPE_VERBATIM:
          if (readLengths(state.MAINTREE_len, 0, 256)) return DECR_ILLEGALDATA
          if (readLengths(state.MAINTREE_len, 256, state.mainElements)) return DECR_ILLEGALDATA
          if (makeDecodeTable(LZX_MAINTREE_MAXSYMBOLS, LZX_MAINTREE_TABLEBITS, state.MAINTREE_len, state.MAINTREE_table)) {
            return DECR_ILLEGALDATA
          }
          if (state.MAINTREE_len[0xe8] !== 0) state.intelStarted = true

          if (readLengths(state.LENGTH_len, 0, LZX_NUM_SECONDARY_LENGTHS)) return DECR_ILLEGALDATA
          if (makeDecodeTable(LZX_LENGTH_MAXSYMBOLS, LZX_LENGTH_TABLEBITS, state.LENGTH_len, state.LENGTH_table)) {
            return DECR_ILLEGALDATA
          }
          break

        case LZX_BLOCKTYPE_UNCOMPRESSED:
          state.intelStarted = true
          ensureBits(16)
          if (bitsleft > 16) inpos -= 2
          R0 = (inData[inpos] | (inData[inpos + 1] << 8) | (inData[inpos + 2] << 16) | (inData[inpos + 3] << 24)) >>> 0
          inpos += 4
          R1 = (inData[inpos] | (inData[inpos + 1] << 8) | (inData[inpos + 2] << 16) | (inData[inpos + 3] << 24)) >>> 0
          inpos += 4
          R2 = (inData[inpos] | (inData[inpos + 1] << 8) | (inData[inpos + 2] << 16) | (inData[inpos + 3] << 24)) >>> 0
          inpos += 4
          break

        default:
          return DECR_ILLEGALDATA
      }
    }

    if (inpos > endinp) {
      if (inpos > endinp + 2 || bitsleft < 16) return DECR_ILLEGALDATA
    }

    while (state.blockRemaining > 0 && togo > 0) {
      let thisRun = state.blockRemaining
      if (thisRun > togo) thisRun = togo
      togo -= thisRun
      state.blockRemaining -= thisRun

      windowPosn &= windowSize - 1
      if (windowPosn + thisRun > windowSize) return DECR_DATAFORMAT

      switch (state.blockType) {
        case LZX_BLOCKTYPE_VERBATIM:
          while (thisRun > 0) {
            const mainElement = readHuffSym(
              state.MAINTREE_table,
              state.MAINTREE_len,
              LZX_MAINTREE_TABLEBITS,
              LZX_MAINTREE_MAXSYMBOLS
            )
            if (mainElement < 0) return DECR_ILLEGALDATA

            if (mainElement < LZX_NUM_CHARS) {
              window[windowPosn++] = mainElement
              thisRun--
            } else {
              const me = mainElement - LZX_NUM_CHARS
              let matchLength = me & LZX_NUM_PRIMARY_LENGTHS
              if (matchLength === LZX_NUM_PRIMARY_LENGTHS) {
                const lf = readHuffSym(state.LENGTH_table, state.LENGTH_len, LZX_LENGTH_TABLEBITS, LZX_LENGTH_MAXSYMBOLS)
                if (lf < 0) return DECR_ILLEGALDATA
                matchLength += lf
              }
              matchLength += LZX_MIN_MATCH

              let matchOffset = me >> 3
              if (matchOffset > 2) {
                if (matchOffset !== 3) {
                  const verbatimBits = readBits(EXTRA_BITS[matchOffset])
                  matchOffset = POSITION_BASE[matchOffset] - 2 + verbatimBits
                } else {
                  matchOffset = 1
                }
                R2 = R1
                R1 = R0
                R0 = matchOffset
              } else if (matchOffset === 0) {
                matchOffset = R0
              } else if (matchOffset === 1) {
                matchOffset = R1
                R1 = R0
                R0 = matchOffset
              } else {
                matchOffset = R2
                R2 = R0
                R0 = matchOffset
              }

              let rundest = windowPosn
              let runsrc = rundest - matchOffset
              windowPosn += matchLength
              if (windowPosn > windowSize) return DECR_ILLEGALDATA
              thisRun -= matchLength

              while (runsrc < 0 && matchLength-- > 0) {
                window[rundest++] = window[runsrc + windowSize]
                runsrc++
              }
              while (matchLength-- > 0) window[rundest++] = window[runsrc++]
            }
          }
          break

        case LZX_BLOCKTYPE_ALIGNED:
          while (thisRun > 0) {
            const mainElement = readHuffSym(
              state.MAINTREE_table,
              state.MAINTREE_len,
              LZX_MAINTREE_TABLEBITS,
              LZX_MAINTREE_MAXSYMBOLS
            )
            if (mainElement < 0) return DECR_ILLEGALDATA

            if (mainElement < LZX_NUM_CHARS) {
              window[windowPosn++] = mainElement
              thisRun--
            } else {
              const me = mainElement - LZX_NUM_CHARS
              let matchLength = me & LZX_NUM_PRIMARY_LENGTHS
              if (matchLength === LZX_NUM_PRIMARY_LENGTHS) {
                const lf = readHuffSym(state.LENGTH_table, state.LENGTH_len, LZX_LENGTH_TABLEBITS, LZX_LENGTH_MAXSYMBOLS)
                if (lf < 0) return DECR_ILLEGALDATA
                matchLength += lf
              }
              matchLength += LZX_MIN_MATCH

              let matchOffset = me >> 3
              if (matchOffset > 2) {
                const extra = EXTRA_BITS[matchOffset]
                matchOffset = POSITION_BASE[matchOffset] - 2
                if (extra > 3) {
                  const verbatimBits = readBits(extra - 3)
                  matchOffset += verbatimBits << 3
                  const alignedBits = readHuffSym(
                    state.ALIGNED_table,
                    state.ALIGNED_len,
                    LZX_ALIGNED_TABLEBITS,
                    LZX_ALIGNED_MAXSYMBOLS
                  )
                  if (alignedBits < 0) return DECR_ILLEGALDATA
                  matchOffset += alignedBits
                } else if (extra === 3) {
                  const alignedBits = readHuffSym(
                    state.ALIGNED_table,
                    state.ALIGNED_len,
                    LZX_ALIGNED_TABLEBITS,
                    LZX_ALIGNED_MAXSYMBOLS
                  )
                  if (alignedBits < 0) return DECR_ILLEGALDATA
                  matchOffset += alignedBits
                } else if (extra > 0) {
                  matchOffset += readBits(extra)
                } else {
                  matchOffset = 1
                }
                R2 = R1
                R1 = R0
                R0 = matchOffset
              } else if (matchOffset === 0) {
                matchOffset = R0
              } else if (matchOffset === 1) {
                matchOffset = R1
                R1 = R0
                R0 = matchOffset
              } else {
                matchOffset = R2
                R2 = R0
                R0 = matchOffset
              }

              let rundest = windowPosn
              let runsrc = rundest - matchOffset
              windowPosn += matchLength
              if (windowPosn > windowSize) return DECR_ILLEGALDATA
              thisRun -= matchLength

              while (runsrc < 0 && matchLength-- > 0) {
                window[rundest++] = window[runsrc + windowSize]
                runsrc++
              }
              while (matchLength-- > 0) window[rundest++] = window[runsrc++]
            }
          }
          break

        case LZX_BLOCKTYPE_UNCOMPRESSED:
          if (inpos + thisRun > endinp) return DECR_ILLEGALDATA
          window.set(inData.subarray(inpos, inpos + thisRun), windowPosn)
          inpos += thisRun
          windowPosn += thisRun
          break

        default:
          return DECR_ILLEGALDATA
      }
    }
  }

  if (togo !== 0) return DECR_ILLEGALDATA

  const copyFrom = (windowPosn === 0 ? windowSize : windowPosn) - outLen
  outData.set(window.subarray(copyFrom, copyFrom + outLen), 0)

  state.windowPosn = windowPosn
  state.R0 = R0
  state.R1 = R1
  state.R2 = R2

  // Intel E8 CALL translation: relative→absolute operands within the first
  // 32768 frames, bounded by intelFilesize. Only active once a 0xE8 main-tree
  // code has appeared (intelStarted).
  if (state.framesRead++ < 32768 && state.intelFilesize !== 0) {
    if (outLen <= 6 || !state.intelStarted) {
      state.intelCurpos += outLen
    } else {
      let dataPos = 0
      const dataEnd = outLen - 10
      let curpos = state.intelCurpos
      const filesize = state.intelFilesize

      state.intelCurpos = curpos + outLen

      while (dataPos < dataEnd) {
        if (outData[dataPos++] !== 0xe8) {
          curpos++
          continue
        }
        const absOff = outData[dataPos] | (outData[dataPos + 1] << 8) | (outData[dataPos + 2] << 16) | (outData[dataPos + 3] << 24)
        if (absOff >= -curpos && absOff < filesize) {
          const relOff = absOff >= 0 ? absOff - curpos : absOff + filesize
          outData[dataPos] = relOff & 0xff
          outData[dataPos + 1] = (relOff >> 8) & 0xff
          outData[dataPos + 2] = (relOff >> 16) & 0xff
          outData[dataPos + 3] = (relOff >> 24) & 0xff
        }
        dataPos += 4
        curpos += 5
      }
    }
  }

  return DECR_OK
}
