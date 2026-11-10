/** A freely redistributable game hosted on the site. Every entry needs an explicit licence and source. */
export interface FreeGame {
  id: string
  title: string
  author: string
  year: number
  genre: string
  license: string
  /** Where the file and its licence statement were obtained (pinned). */
  sourceUrl: string
  /** Source code of the exact build, when the licence requires it (GPL). */
  sourceCode?: string
  /** File name in the public bucket under `free/`. */
  file: string
  cover?: string
  sizeBytes: number
  /** Attribution lines shown on the site (CC BY etc.). */
  credits: string[]
}

const ID = /^[a-z0-9][a-z0-9-]{1,40}$/
const FILE = /^[a-z0-9][a-z0-9._-]{1,80}\.(chd|pbp|iso|png|jpg|webp)$/

export function parseFreeGames(raw: unknown): FreeGame[] {
  if (!Array.isArray(raw)) throw new Error('free games manifest must be an array')
  const seen = new Set<string>()
  return raw.map((e, i) => {
    const g = e as Partial<FreeGame>
    const where = `free game #${i}`
    if (typeof g.id !== 'string' || !ID.test(g.id)) throw new Error(`${where}: bad id`)
    if (seen.has(g.id)) throw new Error(`${where}: duplicate id ${g.id}`)
    seen.add(g.id)
    for (const k of ['title', 'author', 'genre', 'license', 'sourceUrl'] as const) {
      if (typeof g[k] !== 'string' || !(g[k] as string).trim()) throw new Error(`${where}: missing ${k}`)
    }
    if (!/^https:\/\//.test(g.sourceUrl!)) throw new Error(`${where}: sourceUrl must be https`)
    if (typeof g.file !== 'string' || !FILE.test(g.file)) throw new Error(`${where}: bad file`)
    if (g.cover !== undefined && !FILE.test(g.cover)) throw new Error(`${where}: bad cover`)
    if (!Number.isSafeInteger(g.sizeBytes) || (g.sizeBytes as number) <= 0) throw new Error(`${where}: bad sizeBytes`)
    if (!Array.isArray(g.credits) || !g.credits.length) throw new Error(`${where}: credits required`)
    return g as FreeGame
  })
}

/** R2 key of a listed game's file or cover; null for anything not in the manifest. */
export function freeFileFor(games: FreeGame[], id: string, kind: 'file' | 'cover'): string | null {
  const g = games.find((x) => x.id === id)
  const name = g ? (kind === 'file' ? g.file : g.cover) : undefined
  return name ? `free/${name}` : null
}
