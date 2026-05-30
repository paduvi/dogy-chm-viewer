/**
 * Ported from chmlib-ts (https://github.com/dmihal/chmlib-ts), a TypeScript port
 * of CHMLib (Jed Wing) and cabextract's LZX (Stuart Caie).
 *
 * Licensed under LGPL-2.1 — see ./NOTICE.md. Keep modifications under LGPL-2.1.
 *
 * The CHM directory: an ITSP header followed by fixed-size chunks. Leaf chunks
 * ("PMGL") list entries (path → section/offset/length); index chunks ("PMGI")
 * form a B-tree over the leaves for fast lookup. All integers little-endian;
 * entry fields are ENCINT variable-length integers.
 */
import { BufferReader } from './buffer-reader'

export const ITSP_V1_LEN = 0x54
export const PMGL_HEADER_LEN = 0x14
export const PMGI_HEADER_LEN = 0x08

/** Which content section an entry lives in. */
export enum ChmSpace {
  Uncompressed = 0,
  Compressed = 1
}

/** A single directory entry. */
export interface ChmUnitInfo {
  /** offset within its content section */
  start: bigint
  /** byte length */
  length: bigint
  space: ChmSpace
  path: string
}

export interface ItspHeader {
  blockLen: number
  /** chunk number of the root index chunk, or -1 if none (then use indexHead) */
  indexRoot: number
  /** chunk number of the first PMGL (leaf) chunk */
  indexHead: number
  numBlocks: number
}

export function parseItspHeader(data: Uint8Array): ItspHeader {
  const r = new BufferReader(data)
  const signature = r.readAscii(4)
  if (signature !== 'ITSP') throw new Error(`ITSP: bad signature "${signature}"`)

  const version = r.readInt32LE()
  const headerLen = r.readInt32LE()
  if (version !== 1) throw new Error(`ITSP: unsupported version ${version}`)
  if (headerLen !== ITSP_V1_LEN) throw new Error(`ITSP: unexpected headerLen ${headerLen}`)

  r.skip(4) // unknown_000c
  const blockLen = r.readUint32LE()
  r.skip(4) // blockidx interval
  r.skip(4) // index depth
  const indexRoot = r.readInt32LE()
  const indexHead = r.readInt32LE()
  r.skip(4) // unknown_0024
  const numBlocks = r.readUint32LE()

  return { blockLen, indexRoot, indexHead, numBlocks }
}

export interface PmglHeader {
  /** bytes of free space (quickref area) at the end of the chunk */
  freeSpace: number
  blockPrev: number
  blockNext: number
}

export function parsePmglHeader(data: Uint8Array): PmglHeader {
  const r = new BufferReader(data)
  const signature = r.readAscii(4)
  if (signature !== 'PMGL') throw new Error(`PMGL: bad signature "${signature}"`)
  const freeSpace = r.readUint32LE()
  r.skip(4) // unknown_0008
  const blockPrev = r.readInt32LE()
  const blockNext = r.readInt32LE()
  return { freeSpace, blockPrev, blockNext }
}

export interface PmgiHeader {
  freeSpace: number
}

export function parsePmgiHeader(data: Uint8Array): PmgiHeader {
  const r = new BufferReader(data)
  const signature = r.readAscii(4)
  if (signature !== 'PMGI') throw new Error(`PMGI: bad signature "${signature}"`)
  return { freeSpace: r.readUint32LE() }
}

const UTF8 = new TextDecoder('utf-8')

/** Read one PMGL leaf entry at the reader's current position. */
export function readPmglEntry(r: BufferReader): ChmUnitInfo {
  const nameLen = Number(r.readEncint())
  const path = UTF8.decode(r.readBytes(nameLen))
  const space = Number(r.readEncint()) as ChmSpace
  const start = r.readEncint()
  const length = r.readEncint()
  return { start, length, space, path }
}

/** CHM path comparison is case-insensitive (matches the C strcasecmp). */
export function pathKey(path: string): string {
  return path.toLowerCase()
}
