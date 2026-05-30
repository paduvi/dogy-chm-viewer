/**
 * Ported from chmlib-ts (https://github.com/dmihal/chmlib-ts), a TypeScript port
 * of CHMLib (Jed Wing) and cabextract's LZX (Stuart Caie).
 *
 * Licensed under LGPL-2.1 — see ./NOTICE.md. Keep modifications under LGPL-2.1.
 */

/**
 * Cursor-based binary reader over a Uint8Array. CHM integers are little-endian;
 * directory entries use ENCINT variable-length integers (big-endian, 7 bits per
 * byte, high bit = continue).
 */
export class BufferReader {
  private view: DataView
  private _offset: number

  constructor(buffer: Uint8Array, offset = 0) {
    this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    this._offset = offset
  }

  get offset(): number {
    return this._offset
  }

  get remaining(): number {
    return this.view.byteLength - this._offset
  }

  readUint8(): number {
    this.assert(1)
    const val = this.view.getUint8(this._offset)
    this._offset += 1
    return val
  }

  readInt32LE(): number {
    this.assert(4)
    const val = this.view.getInt32(this._offset, true)
    this._offset += 4
    return val
  }

  readUint32LE(): number {
    this.assert(4)
    const val = this.view.getUint32(this._offset, true)
    this._offset += 4
    return val
  }

  readBigUint64LE(): bigint {
    this.assert(8)
    const val = this.view.getBigUint64(this._offset, true)
    this._offset += 8
    return val
  }

  readBytes(count: number): Uint8Array {
    this.assert(count)
    const result = new Uint8Array(this.view.buffer, this.view.byteOffset + this._offset, count)
    this._offset += count
    return result.slice() // copy so the caller owns the data
  }

  readAscii(count: number): string {
    return String.fromCharCode(...this.readBytes(count))
  }

  skip(count: number): void {
    this.assert(count)
    this._offset += count
  }

  /**
   * Read an ENCINT (a.k.a. CWord): variable-length integer used by PMGL/PMGI
   * entries. Big-endian, 7 bits per byte; high bit set means another byte follows.
   * Returns bigint to stay exact for 64-bit offsets/lengths.
   */
  readEncint(): bigint {
    let accum = 0n
    let temp: number
    while ((temp = this.readUint8()) >= 0x80) {
      accum <<= 7n
      accum += BigInt(temp & 0x7f)
    }
    return (accum << 7n) + BigInt(temp)
  }

  private assert(need: number): void {
    if (this._offset + need > this.view.byteLength) {
      throw new RangeError(`BufferReader: read past end (offset=${this._offset}, need ${need})`)
    }
  }
}
