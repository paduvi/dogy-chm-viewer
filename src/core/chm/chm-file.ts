/**
 * Ported from chmlib-ts (https://github.com/dmihal/chmlib-ts), a TypeScript port
 * of CHMLib (Jed Wing) and cabextract's LZX (Stuart Caie).
 *
 * Licensed under LGPL-2.1 — see ./NOTICE.md. Keep modifications under LGPL-2.1.
 *
 * High-level CHM reader implementing the synchronous ChmBackend. The whole file
 * lives in memory (open takes a Uint8Array), so reads are plain buffer slices —
 * no async I/O. Uncompressed entries are sliced directly; compressed entries are
 * LZX-decompressed block-by-block using the reset table for random access.
 */
import type { ChmBackend, ChmEntry } from './backend'
import { BufferReader } from './buffer-reader'
import { parseItsfHeader } from './itsf'
import {
  parseItspHeader,
  parsePmglHeader,
  parsePmgiHeader,
  readPmglEntry,
  pathKey,
  ChmSpace,
  type ChmUnitInfo
} from './directory'
import {
  LZXState,
  lzxDecompress,
  parseLzxcControlData,
  parseLzxcResetTable,
  LZXC_RESET_TABLE_LEN,
  DECR_OK,
  type LzxcResetTable
} from './lzx'

const CHMU_RESET_TABLE =
  '::DataSpace/Storage/MSCompressed/Transform/' +
  '{7FC28940-9D31-11D0-9B27-00A0C91E9C7C}/' +
  'InstanceData/ResetTable'
const CHMU_LZXC_CONTROLDATA = '::DataSpace/Storage/MSCompressed/ControlData'
const CHMU_CONTENT = '::DataSpace/Storage/MSCompressed/Content'

const MAX_BLOCKS_CACHED = 5

const UTF8 = new TextDecoder('utf-8')

export class ChmFile implements ChmBackend {
  private buffer: Uint8Array | null = null

  private dirOffset = 0n
  private dataOffset = 0n
  private indexRoot = 0
  private indexHead = 0
  private blockLen = 0

  // Compression setup
  private compressionEnabled = false
  private rtUnit!: ChmUnitInfo
  private cnUnit!: ChmUnitInfo
  private resetTable!: LzxcResetTable
  private windowSize = 0
  private resetBlkCount = 0

  // LZX decoder + block cache
  private lzxState: LZXState | null = null
  private lzxLastBlock = -1
  private cacheBlocks: (Uint8Array | null)[] = new Array<Uint8Array | null>(MAX_BLOCKS_CACHED).fill(null)
  private cacheBlockIndices: number[] = new Array<number>(MAX_BLOCKS_CACHED).fill(-1)

  open(buffer: Uint8Array): void {
    this.buffer = buffer

    const itsf = parseItsfHeader(this.fetch(0n, 0x60))
    this.dirOffset = itsf.dirOffset
    this.dataOffset = itsf.dataOffset

    const itsp = parseItspHeader(this.fetch(itsf.dirOffset, 0x54))
    this.dirOffset += 0x54n // directory chunks follow the ITSP header
    this.indexRoot = itsp.indexRoot <= -1 ? itsp.indexHead : itsp.indexRoot
    this.indexHead = itsp.indexHead
    this.blockLen = itsp.blockLen

    this.setupCompression()
  }

  list(): ChmEntry[] {
    this.assertOpen()
    const entries: ChmEntry[] = []
    for (const e of this.enumerate()) {
      entries.push({ path: e.path, size: Number(e.length) })
    }
    return entries
  }

  read(internalPath: string): Uint8Array {
    this.assertOpen()
    const ui = this.resolve(internalPath)
    if (!ui) throw new Error(`CHM entry not found: ${internalPath}`)
    return this.retrieve(ui)
  }

  close(): void {
    this.buffer = null
    this.lzxState = null
    this.cacheBlocks.fill(null)
  }

  // --- internals ---

  private assertOpen(): void {
    if (this.buffer === null) throw new Error('ChmFile: call open() first')
  }

  /** Return a copy of `length` bytes at absolute file offset `offset`. */
  private fetch(offset: bigint, length: number): Uint8Array {
    const buf = this.buffer!
    const start = Number(offset)
    const end = Math.min(start + length, buf.length)
    return buf.slice(start, end)
  }

  private setupCompression(): void {
    try {
      const rtUnit = this.resolve(CHMU_RESET_TABLE)
      const cnUnit = this.resolve(CHMU_CONTENT)
      const uiLzxc = this.resolve(CHMU_LZXC_CONTROLDATA)
      if (
        !rtUnit ||
        !cnUnit ||
        !uiLzxc ||
        rtUnit.space === ChmSpace.Compressed ||
        cnUnit.space === ChmSpace.Compressed ||
        uiLzxc.space === ChmSpace.Compressed
      ) {
        return
      }

      const resetTable = parseLzxcResetTable(this.fetch(this.dataOffset + rtUnit.start, LZXC_RESET_TABLE_LEN))
      const ctlData = parseLzxcControlData(this.fetch(this.dataOffset + uiLzxc.start, Number(uiLzxc.length)))

      this.rtUnit = rtUnit
      this.cnUnit = cnUnit
      this.resetTable = resetTable
      this.windowSize = ctlData.windowSize
      this.resetBlkCount = (ctlData.resetInterval / (ctlData.windowSize / 2)) * ctlData.windowsPerReset
      this.compressionEnabled = true
    } catch {
      // Uncompressed CHM, or compression metadata absent — leave disabled.
      this.compressionEnabled = false
    }
  }

  /** Resolve a path → entry, using the PMGI B-tree, falling back to a linear scan. */
  private resolve(objPath: string): ChmUnitInfo | null {
    const indexed = this.resolveIndexed(objPath)
    if (indexed) return indexed

    const key = pathKey(objPath)
    for (const entry of this.enumerate()) {
      if (pathKey(entry.path) === key) return entry
    }
    return null
  }

  private resolveIndexed(objPath: string): ChmUnitInfo | null {
    let curPage = this.indexRoot
    while (curPage !== -1) {
      const pageBuf = this.fetch(this.dirOffset + BigInt(curPage) * BigInt(this.blockLen), this.blockLen)
      const sig = String.fromCharCode(pageBuf[0], pageBuf[1], pageBuf[2], pageBuf[3])
      if (sig === 'PMGL') {
        return this.findInPmgl(pageBuf, objPath)
      } else if (sig === 'PMGI') {
        curPage = this.findInPmgi(pageBuf, objPath)
      } else {
        return null
      }
    }
    return null
  }

  private findInPmgi(pageBuf: Uint8Array, objPath: string): number {
    const header = parsePmgiHeader(pageBuf.subarray(0, 8))
    const end = pageBuf.length - header.freeSpace
    const r = new BufferReader(pageBuf, 8)
    const key = pathKey(objPath)
    let page = -1
    while (r.offset < end) {
      const nameLen = Number(r.readEncint())
      const path = UTF8.decode(r.readBytes(nameLen))
      if (pathKey(path) > key) return page
      page = Number(r.readEncint())
    }
    return page
  }

  private findInPmgl(pageBuf: Uint8Array, objPath: string): ChmUnitInfo | null {
    const header = parsePmglHeader(pageBuf.subarray(0, 0x14))
    const end = pageBuf.length - header.freeSpace
    const r = new BufferReader(pageBuf, 0x14)
    const key = pathKey(objPath)
    while (r.offset < end) {
      const entry = readPmglEntry(r)
      if (pathKey(entry.path) === key) return entry
    }
    return null
  }

  /** Yield every directory entry by walking the linked list of PMGL leaf chunks. */
  private *enumerate(): Generator<ChmUnitInfo> {
    let curPage = this.indexHead
    while (curPage !== -1) {
      const pageBuf = this.fetch(this.dirOffset + BigInt(curPage) * BigInt(this.blockLen), this.blockLen)
      const header = parsePmglHeader(pageBuf.subarray(0, 0x14))
      const end = pageBuf.length - header.freeSpace
      const r = new BufferReader(pageBuf, 0x14)
      while (r.offset < end) {
        yield readPmglEntry(r)
      }
      curPage = header.blockNext
    }
  }

  /** Extract a whole entry's bytes (uncompressed slice or LZX-decompressed region). */
  private retrieve(ui: ChmUnitInfo): Uint8Array {
    if (ui.length === 0n) return new Uint8Array(0)

    if (ui.space === ChmSpace.Uncompressed) {
      return this.fetch(this.dataOffset + ui.start, Number(ui.length))
    }

    if (!this.compressionEnabled) {
      throw new Error(`CHM entry is compressed but compression metadata is unavailable: ${ui.path}`)
    }
    return this.decompressRegion(ui.start, ui.length)
  }

  private getCmpBlockBounds(block: bigint): { start: bigint; len: bigint } {
    const tableBase = this.dataOffset + this.rtUnit.start + BigInt(this.resetTable.tableOffset)
    const rawStart = new BufferReader(this.fetch(tableBase + block * 8n, 8)).readBigUint64LE()
    const rawEnd =
      block < BigInt(this.resetTable.blockCount - 1)
        ? new BufferReader(this.fetch(tableBase + block * 8n + 8n, 8)).readBigUint64LE()
        : this.resetTable.compressedLen
    return { start: rawStart + this.dataOffset + this.cnUnit.start, len: rawEnd - rawStart }
  }

  private decompressOneBlock(blockIdx: number): Uint8Array {
    const blockLen = Number(this.resetTable.blockLen)
    const slot = blockIdx % MAX_BLOCKS_CACHED
    let ubuf = this.cacheBlocks[slot]
    if (!ubuf) {
      ubuf = new Uint8Array(blockLen)
      this.cacheBlocks[slot] = ubuf
    }
    this.cacheBlockIndices[slot] = blockIdx

    const { start, len } = this.getCmpBlockBounds(BigInt(blockIdx))
    const cbuf = this.fetch(start, Number(len))
    const res = lzxDecompress(this.lzxState!, cbuf, ubuf, Number(len), blockLen)
    if (res !== DECR_OK) throw new Error(`LZX decompression failed for block ${blockIdx}: code ${res}`)
    this.lzxLastBlock = blockIdx
    return ubuf
  }

  /**
   * Decompress one block, replaying preceding blocks in the same reset interval
   * when necessary so the LZX window is correct (mirrors C _chm_decompress_block).
   */
  private decompressBlock(block: bigint): Uint8Array {
    const blockIdx = Number(block)

    if (!this.lzxState) {
      let windowBits = 0
      for (let ws = this.windowSize; ws > 1; ws >>>= 1) windowBits++
      this.lzxState = new LZXState(windowBits)
      this.lzxLastBlock = -1
    }

    let blockAlign = blockIdx % this.resetBlkCount
    if (blockIdx - blockAlign <= this.lzxLastBlock && blockIdx >= this.lzxLastBlock) {
      blockAlign = blockIdx - this.lzxLastBlock
    }

    if (blockAlign !== 0) {
      for (let i = blockAlign; i > 0; i--) {
        const curBlockIdx = blockIdx - i
        if (this.lzxLastBlock !== curBlockIdx) {
          if (curBlockIdx % this.resetBlkCount === 0) this.lzxState.reset()
          this.decompressOneBlock(curBlockIdx)
        }
      }
    } else if (blockIdx % this.resetBlkCount === 0) {
      this.lzxState.reset()
    }

    return this.decompressOneBlock(blockIdx)
  }

  private decompressRegion(start: bigint, len: bigint): Uint8Array {
    const blockLen = this.resetTable.blockLen
    const result = new Uint8Array(Number(len))
    let written = 0n
    let remaining = len
    let pos = start

    while (remaining > 0n) {
      const nBlock = pos / blockLen
      const nOffset = pos % blockLen
      let nLen = remaining
      if (nLen > blockLen - nOffset) nLen = blockLen - nOffset

      const slot = Number(nBlock % BigInt(MAX_BLOCKS_CACHED))
      const hit = this.cacheBlocks[slot]
      const cached =
        hit !== null && this.cacheBlockIndices[slot] === Number(nBlock) ? hit : this.decompressBlock(nBlock)

      result.set(cached.subarray(Number(nOffset), Number(nOffset + nLen)), Number(written))
      written += nLen
      remaining -= nLen
      pos += nLen
    }

    return result
  }
}
