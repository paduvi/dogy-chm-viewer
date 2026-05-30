import { describe, it, expect } from 'vitest'
import { decodeEntities } from '@core/chm/sitemap'
import { parseHhc } from '@core/chm/hhc'
import { parseHhk } from '@core/chm/hhk'
import { stripFragment, basename } from '@core/chm/path-utils'

const HHC = `<html><!-- Sitemap 1.0 -->
<object type="text/site properties"><param name="SiteType" value="toc"></object>
<ul>
  <li><object type="text/sitemap">
    <param name="Name" value="Preface">
    <param name="Local" value="front/preface.htm">
  </object>
  <ul>
    <li><object type="text/sitemap">
      <param name="Name" value="Audience &amp; Scope">
      <param name="Local" value="front/audience.htm#a1">
    </object>
  </ul>
  <li><object type="text/sitemap">
    <param name="Name" value="Chapter 1">
    <param name="Local" value="ch1.htm">
  </object>
</ul></html>`

describe('parseHhc', () => {
  const toc = parseHhc(HHC)

  it('builds the top-level structure', () => {
    expect(toc).toHaveLength(2)
    expect(toc[0].name).toBe('Preface')
    expect(toc[1].name).toBe('Chapter 1')
  })

  it('nests children under the preceding node via <ul>', () => {
    expect(toc[0].children).toHaveLength(1)
    expect(toc[0].children[0].name).toBe('Audience & Scope') // entity decoded
    expect(toc[0].children[0].localPath).toBe('front/audience.htm#a1') // fragment kept
    expect(toc[1].children).toHaveLength(0)
  })

  it('assigns unique ids', () => {
    const ids = new Set<string>()
    const collect = (nodes: typeof toc): void => {
      for (const n of nodes) {
        ids.add(n.id)
        collect(n.children)
      }
    }
    collect(toc)
    expect(ids.size).toBe(3)
  })

  it('ignores the site-properties object', () => {
    expect(toc.every((n) => n.name !== '')).toBe(true)
  })
})

const HHK = `<html><object type="text/site properties"><param name="SiteType" value="index"></object>
<ul>
  <li><object type="text/sitemap">
    <param name="Name" value="ability">
    <param name="Name" value="Ability Catalog">
    <param name="Local" value="a/catalog.htm">
    <param name="Local" value="a/catalog2.htm">
  </object>
  <ul>
    <li><object type="text/sitemap">
      <param name="Name" value="provider">
      <param name="Local" value="a/provider.htm">
    </object>
  </ul>
</ul></html>`

describe('parseHhk', () => {
  const index = parseHhk(HHK)

  it('uses the first Name as the keyword and collects all Locals', () => {
    expect(index[0].name).toBe('ability')
    expect(index[0].localPaths).toEqual(['a/catalog.htm', 'a/catalog2.htm'])
    expect(index[0].depth).toBe(0)
  })

  it('flattens sub-keywords with increasing depth', () => {
    expect(index).toHaveLength(2)
    expect(index[1].name).toBe('provider')
    expect(index[1].depth).toBe(1)
  })
})

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('A&amp;B &lt;x&gt; &#65; &#x42;')).toBe('A&B <x> A B')
  })
  it('leaves unknown entities untouched', () => {
    expect(decodeEntities('100&unknown;')).toBe('100&unknown;')
  })
})

describe('path-utils', () => {
  it('strips fragments', () => {
    expect(stripFragment('a/b.htm#frag')).toBe('a/b.htm')
    expect(stripFragment('a/b.htm')).toBe('a/b.htm')
  })
  it('extracts basenames', () => {
    expect(basename('/Users/x/My Help.chm')).toBe('My Help.chm')
    expect(basename('a\\b\\c.htm')).toBe('c.htm')
  })
})
