import { strToU8, zipSync, type Zippable } from 'fflate'
import type { LocalGame } from '~~/shared/types/game'

export type BlobGetter = (blobKey: string) => Promise<Blob | undefined>

/**
 * Builds the single File handed to EmulatorJS (it accepts exactly one input).
 * Single images are passed through untouched; multi-file games are packed into a
 * store-only zip (no compression) that EmulatorJS extracts client-side.
 */
export async function buildGameFile(game: LocalGame, getBlob: BlobGetter, onProgress?: (fraction: number) => void): Promise<File> {
  const total = game.files.length
  const report = (done: number) => onProgress?.(total === 0 ? 1 : done / total)

  if (game.kind === 'single') {
    const ref = game.files[0]
    if (!ref) throw new Error('Game has no files')
    const blob = await getBlob(ref.blobKey)
    if (!blob) throw new Error(`Missing stored file: ${ref.name}`)
    report(1)
    return new File([blob], ref.name)
  }

  const entries: Zippable = {}
  let done = 0
  for (const ref of game.files) {
    const blob = await getBlob(ref.blobKey)
    if (!blob) throw new Error(`Missing stored file: ${ref.name}`)
    entries[ref.name] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }]
    report(++done)
  }
  if (game.generatedM3u) {
    entries[game.primaryName] = [strToU8(game.generatedM3u), { level: 0 }]
  }
  const zipped = zipSync(entries, { level: 0 })
  report(total)
  return new File([zipped], `${game.title}.zip`, { type: 'application/zip' })
}
