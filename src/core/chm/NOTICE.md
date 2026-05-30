# Third-party code notice — `src/core/chm/`

The CHM container parser and LZX decompressor in this directory are **ported from
[chmlib-ts](https://github.com/dmihal/chmlib-ts)** by David Mihal, which is itself
a TypeScript port of:

- **CHMLib** by Jed Wing — the ITSF/ITSP/PMGL container logic, and
- **cabextract** by Stuart Caie — the LZX decompression engine.

## License

chmlib-ts is licensed under the **GNU Lesser General Public License v2.1
(LGPL-2.1)**. Because the files in this directory are a derivative work, they are
**also covered by LGPL-2.1**, not the project's primary license.

Files carrying this obligation (LGPL-2.1 header):

- `buffer-reader.ts`
- `itsf.ts`
- `directory.ts`
- `lzx.ts`
- `chm-file.ts`

The rest of the application links against this directory through the
`ChmBackend` interface (`backend.ts`). LGPL-2.1 permits this (weak copyleft):
the application as a whole may use a different license, provided the LGPL'd
parser remains LGPL and relinkable. Keep modifications to the files above under
LGPL-2.1.

Full LGPL-2.1 text: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
