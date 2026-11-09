export type GameKind = 'single' | 'multi'

export interface GameFileRef {
  name: string
  size: number
  blobKey: string
}

export interface ClassifiedGame {
  title: string
  kind: GameKind
  /** File name EmulatorJS should see: the image itself, the .cue, or the (possibly generated) .m3u. */
  primaryName: string
  files: File[]
  /** Present when several discs were added without an .m3u; content of the playlist to generate. */
  generatedM3u?: string
  totalBytes: number
}

export type ClassifyErrorCode =
  | 'empty'
  | 'unsupported'
  | 'missing-cue'
  | 'missing-bin'
  | 'missing-m3u-disc'
  | 'mixed'

export interface ClassifyError {
  code: ClassifyErrorCode
  details: string[]
}

export type ClassifyResult = { ok: true; game: ClassifiedGame } | { ok: false; error: ClassifyError }
