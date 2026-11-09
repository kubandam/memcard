import type { H3Event } from 'h3'
import { createD1Store, createMemoryStore, type LibraryStore } from './libraryStore'

let memory: LibraryStore | null = null

export function useLibraryStore(event: H3Event): LibraryStore {
  if (process.env.MEMCARD_MEMORY_STORE === '1') return (memory ??= createMemoryStore())
  return createD1Store(useBindings(event).DB)
}
