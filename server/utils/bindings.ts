/// <reference types="@cloudflare/workers-types" />
import type { H3Event } from 'h3'

export interface MemcardEnv {
  DB: D1Database
  R2: R2Bucket
  RL_CREATE?: { limit: (opts: { key: string }) => Promise<{ success: boolean }> }
  MEMCARD_INVITES?: string
  TOTAL_BYTES_LIMIT?: string
}

export function useBindings(event: H3Event): MemcardEnv {
  const env = (event.context as { cloudflare?: { env?: MemcardEnv } }).cloudflare?.env
  if (!env?.DB || !env?.R2) throw createError({ statusCode: 500, statusMessage: 'Cloudflare bindings unavailable' })
  return env
}
