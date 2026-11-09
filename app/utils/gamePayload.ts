import type { LocalGame } from '~~/shared/types/game'

export type BlobGetter = (blobKey: string) => Promise<Blob | undefined>

/** A file to place in the emulator's virtual file system before the game loads. */
export interface ExtraFile {
  /** Absolute path in the EmulatorJS FS, e.g. `/Game (Disc 2).chd`. */
  path: string
  data: Uint8Array
}

export interface GamePayload {
  /** What EmulatorJS receives as `EJS_gameUrl` — the image, the .cue, or the .m3u playlist. */
  file: File
  /** Everything the primary file refers to, written next to it (at `/`) before boot. */
  extraFiles: ExtraFile[]
}

/**
 * EmulatorJS accepts exactly one input and, given an archive, prefers a disc image over the
 * playlist inside it. So multi-file games are not zipped: the playlist/cue is the input and
 * the discs/tracks are written into the FS via the `saveDatabaseLoaded` hook.
 */
export async function buildGamePayload(game: LocalGame, getBlob: BlobGetter, onProgress?: (fraction: number) => void): Promise<GamePayload> {
  const total = Math.max(1, game.files.length)
  let done = 0
  const report = () => onProgress?.(Math.min(1, ++done / total))

  const read = async (name: string, blobKey: string): Promise<Blob> => {
    const blob = await getBlob(blobKey)
    if (!blob) throw new Error(`Missing stored file: ${name}`)
    return blob
  }

  if (game.kind === 'single') {
    const ref = game.files[0]
    if (!ref) throw new Error('Game has no files')
    const blob = await read(ref.name, ref.blobKey)
    report()
    return { file: new File([blob], ref.name), extraFiles: [] }
  }

  let primary: File | null = null
  const extraFiles: ExtraFile[] = []
  for (const ref of game.files) {
    const blob = await read(ref.name, ref.blobKey)
    if (!game.generatedM3u && ref.name === game.primaryName) {
      primary = new File([blob], ref.name)
    } else {
      extraFiles.push({ path: `/${ref.name}`, data: new Uint8Array(await blob.arrayBuffer()) })
    }
    report()
  }
  if (game.generatedM3u) {
    primary = new File([game.generatedM3u], game.primaryName, { type: 'audio/x-mpegurl' })
  }
  if (!primary) throw new Error(`Primary file not found among stored files: ${game.primaryName}`)
  onProgress?.(1)
  return { file: primary, extraFiles }
}
