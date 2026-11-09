import type { GameKind } from './game'

export interface CloudFileRef {
  name: string
  size: number
  objectKey: string
  chunks: number
}

export interface CloudGame {
  id: string
  title: string
  kind: GameKind
  primaryName: string
  files: CloudFileRef[]
  generatedM3u?: string
  coverObjectKey?: string
  coverSize?: number
  sizeBytes: number
  createdAt: number
  lastPlayedAt: number | null
  /** base64url of the 32-byte per-game key. */
  kGame: string
}

export interface LibraryManifest {
  version: 1
  games: CloudGame[]
}

export interface LibraryUsage {
  bytesUsed: number
  softLimit: number
  hardLimit: number
}
