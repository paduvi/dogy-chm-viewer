// ChmBackend — the single interface all CHM decoders must implement.
// The pure-TS implementation in chm-file.ts is the default.
// A native chmlib binding can be slotted in behind this interface if needed.

export interface ChmEntry {
  path: string
  size: number
}

export interface ChmBackend {
  /** Open a CHM from a buffer. Must be called before any other method. */
  open(buffer: Uint8Array): void
  /** List all internal entries. */
  list(): ChmEntry[]
  /** Extract a single internal entry by its internal path. */
  read(internalPath: string): Uint8Array
  /** Release any held resources. */
  close(): void
}
