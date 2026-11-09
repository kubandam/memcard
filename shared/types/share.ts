import type { CloudGame } from './library'

export type SharePayload = { v: 1; kind: 'library'; kLib: string } | { v: 1; kind: 'game'; game: CloudGame }
