import { deriveStateKeys, openSave, sealSave } from '~~/shared/utils/saveSync'
import type { CloudApi } from './cloudApi'

type BlobApi = Pick<CloudApi, 'getBlob' | 'putBlob'>

/**
 * One synced save-state slot per game (plus its screenshot), encrypted under keys derived from K_game.
 * Uploads are serialised so a quick second save waits for the first and wins.
 */
export function createStateSync(opts: { api: BlobApi; kGame: Uint8Array; now?: () => number }) {
  const now = opts.now ?? Date.now
  const keysP = deriveStateKeys(opts.kGame)
  let chain: Promise<unknown> = Promise.resolve()

  async function save(s: { state: Uint8Array; screenshot: Uint8Array | null }): Promise<boolean> {
    const run = async () => {
      const k = await keysP
      const at = now()
      try {
        if (s.screenshot?.length) await opts.api.putBlob('shot', k.shotKey, await sealSave(k.key, k.shotKey, s.screenshot, at))
        await opts.api.putBlob('state', k.stateKey, await sealSave(k.key, k.stateKey, s.state, at))
        return true
      } catch {
        return false
      }
    }
    const result = chain.then(run, run)
    chain = result
    return result
  }

  /** The latest synced state, or null (none yet, offline, or not decryptable for this game). */
  async function loadLatest(): Promise<Uint8Array | null> {
    try {
      const k = await keysP
      const bytes = await opts.api.getBlob('state', k.stateKey)
      return bytes ? (await openSave(k.key, k.stateKey, bytes)).card : null
    } catch {
      return null
    }
  }

  /** Screenshot of the latest synced state and when it was taken, or null. */
  async function latestShot(): Promise<{ image: Uint8Array; updatedAt: number } | null> {
    try {
      const k = await keysP
      const bytes = await opts.api.getBlob('shot', k.shotKey)
      if (!bytes) return null
      const o = await openSave(k.key, k.shotKey, bytes)
      return { image: o.card, updatedAt: o.updatedAt }
    } catch {
      return null
    }
  }

  return { save, loadLatest, latestShot }
}
