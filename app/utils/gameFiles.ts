import type { ClassifiedGame, ClassifyError, ClassifyResult } from '~~/shared/types/game'

export const SUPPORTED_EXTENSIONS = ['chd', 'pbp', 'iso', 'img', 'bin', 'cue', 'm3u', 'zip', '7z'] as const
export type SupportedExtension = (typeof SUPPORTED_EXTENSIONS)[number]

/** Extensions that are a complete game on their own. */
const SINGLE_IMAGE_EXTENSIONS = new Set(['chd', 'pbp', 'iso', 'img', 'zip', '7z'])
/** Extensions that can be one disc of a multi-disc set. */
const DISC_EXTENSIONS = new Set(['chd', 'pbp', 'iso', 'img'])

export function extensionOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i === -1 ? '' : name.slice(i + 1).toLowerCase()
}

export function isSupported(name: string): boolean {
  return (SUPPORTED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export function titleFromFilename(name: string): string {
  const dot = name.lastIndexOf('.')
  let base = dot > 0 ? name.slice(0, dot) : name
  // Strip trailing "(USA)", "(Disc 1)", "[!]" groups, repeatedly.
  let prev: string
  do {
    prev = base
    base = base.replace(/\s*(\([^()]*\)|\[[^\]]*\])\s*$/u, '')
  } while (base !== prev)
  base = base.replace(/\s+/g, ' ').trim()
  return base || name
}

export function parseCue(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*FILE\s+(?:"([^"]+)"|(\S+))\s+\S+\s*$/i.exec(line)
    if (m) names.push((m[1] ?? m[2])!)
  }
  return names
}

export function parseM3u(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'))
}

export function generateM3u(discNames: string[]): string {
  return discNames.map((n) => `${n}\n`).join('')
}

function fail(code: ClassifyError['code'], details: string[] = []): ClassifyResult {
  return { ok: false, error: { code, details } }
}

function ok(game: ClassifiedGame): ClassifyResult {
  return { ok: true, game }
}

function sum(files: File[]): number {
  return files.reduce((n, f) => n + f.size, 0)
}

function findByName(files: File[], wanted: string): File | undefined {
  const lower = wanted.toLowerCase()
  return files.find((f) => f.name.toLowerCase() === lower)
}

export async function classifyFiles(files: File[]): Promise<ClassifyResult> {
  if (files.length === 0) return fail('empty')

  const unsupported = files.filter((f) => !isSupported(f.name)).map((f) => f.name)
  if (unsupported.length) return fail('unsupported', unsupported)

  const byExt = (ext: string) => files.filter((f) => extensionOf(f.name) === ext)
  const cues = byExt('cue')
  const m3us = byExt('m3u')
  const bins = byExt('bin')

  if (m3us.length > 1 || cues.length > 1) {
    return fail('mixed', [...m3us.slice(1), ...cues.slice(1)].map((f) => f.name))
  }

  // Explicit playlist: every listed disc (or cue) must be present.
  if (m3us.length === 1) {
    const m3u = m3us[0]!
    const listed = parseM3u(await m3u.text())
    const missing = listed.filter((n) => !findByName(files, n))
    if (missing.length) return fail('missing-m3u-disc', missing)
    const referenced = new Set(listed.map((n) => n.toLowerCase()))
    if (cues.length === 1) {
      for (const n of parseCue(await cues[0]!.text())) referenced.add(n.toLowerCase())
    }
    const extra = files.filter((f) => f !== m3u && !referenced.has(f.name.toLowerCase())).map((f) => f.name)
    if (extra.length) return fail('mixed', extra)
    return ok({
      title: titleFromFilename(m3u.name),
      kind: 'multi',
      primaryName: m3u.name,
      files: [m3u, ...listed.map((n) => findByName(files, n)!)],
      totalBytes: sum(files),
    })
  }

  // Cue sheet: every referenced track file must be present and nothing else may be there.
  if (cues.length === 1) {
    const cue = cues[0]!
    const referenced = parseCue(await cue.text())
    const missing = referenced.filter((n) => !findByName(files, n))
    if (missing.length) return fail('missing-bin', missing)
    const refSet = new Set(referenced.map((n) => n.toLowerCase()))
    const extra = files.filter((f) => f !== cue && !refSet.has(f.name.toLowerCase())).map((f) => f.name)
    if (extra.length) return fail('mixed', extra)
    return ok({
      title: titleFromFilename(cue.name),
      kind: 'multi',
      primaryName: cue.name,
      files: [cue, ...referenced.map((n) => findByName(files, n)!)],
      totalBytes: sum(files),
    })
  }

  if (bins.length) return fail('missing-cue', bins.map((f) => f.name))

  // Only disc images / archives remain.
  if (files.length === 1) {
    const only = files[0]!
    if (!SINGLE_IMAGE_EXTENSIONS.has(extensionOf(only.name))) return fail('unsupported', [only.name])
    return ok({ title: titleFromFilename(only.name), kind: 'single', primaryName: only.name, files: [only], totalBytes: only.size })
  }

  // Several disc images without a playlist: they must look like discs of one game.
  const discs = files.filter((f) => DISC_EXTENSIONS.has(extensionOf(f.name)))
  if (discs.length !== files.length) return fail('mixed', files.filter((f) => !DISC_EXTENSIONS.has(extensionOf(f.name))).map((f) => f.name))
  const titles = new Set(discs.map((f) => titleFromFilename(f.name)))
  if (titles.size !== 1) return fail('mixed', discs.map((f) => f.name))
  const sorted = [...discs].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  const title = titles.values().next().value as string
  return ok({
    title,
    kind: 'multi',
    primaryName: `${title}.m3u`,
    files: sorted,
    generatedM3u: generateM3u(sorted.map((f) => f.name)),
    totalBytes: sum(sorted),
  })
}
