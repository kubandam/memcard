// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (p.endsWith('.vue')) out.push(p)
  }
  return out
}

/** Design rule (plan "Global Constraints"): colours live in tokens.css only. */
describe('design tokens', () => {
  it('no raw colour literals in components, pages or layouts', () => {
    const files = [...walk('app/components'), ...walk('app/pages'), ...walk('app/layouts')]
    const offenders: string[] = []
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      const style = src.match(/<style[^>]*>([\s\S]*?)<\/style>/g)?.join('\n') ?? ''
      const hits = style.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g)
      if (hits) offenders.push(`${file}: ${hits.join(', ')}`)
    }
    expect(offenders).toEqual([])
  })
})
