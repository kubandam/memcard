// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { decideOnStart, deriveSaveKeys, fingerprint, openSave, sealSave } from '../../shared/utils/saveSync'
import { newGameKey } from '../../shared/utils/chunkCrypto'

const card = (n: number) => new Uint8Array(128).fill(n)

describe('save crypto', () => {
  it('derives a stable 23-char save key per game', async () => {
    const k = newGameKey()
    const a = await deriveSaveKeys(k)
    expect(a.saveKey).toMatch(/^[0-9a-hjkmnp-tv-z]{23}$/)
    expect((await deriveSaveKeys(k)).saveKey).toBe(a.saveKey)
    expect((await deriveSaveKeys(newGameKey())).saveKey).not.toBe(a.saveKey)
  })

  it('seals and opens with timestamp and fingerprint; random IV each time', async () => {
    const { saveKey, key } = await deriveSaveKeys(newGameKey())
    const a = await sealSave(key, saveKey, card(1), 1234)
    const b = await sealSave(key, saveKey, card(1), 1234)
    expect(a.subarray(0, 12)).not.toEqual(b.subarray(0, 12))
    expect(await openSave(key, saveKey, a)).toEqual({ card: card(1), updatedAt: 1234, hash: fingerprint(card(1)) })
  })

  it('rejects tampering, another game key, and another save key (AAD)', async () => {
    const g = await deriveSaveKeys(newGameKey())
    const sealed = await sealSave(g.key, g.saveKey, card(2), 1)
    const t = sealed.slice(); t[20]! ^= 1
    await expect(openSave(g.key, g.saveKey, t)).rejects.toThrow()
    const other = await deriveSaveKeys(newGameKey())
    await expect(openSave(other.key, g.saveKey, sealed)).rejects.toThrow()
    await expect(openSave(g.key, other.saveKey, sealed)).rejects.toThrow()
  })

  it('fingerprint handles megabytes quickly', () => {
    const big = new Uint8Array(16 * 1024 * 1024).fill(3)
    const t = performance.now()
    expect(fingerprint(big)).toMatch(/^[0-9a-f]{16}$/)
    expect(performance.now() - t).toBeLessThan(1500)
  })

  it('fingerprint is a 16-char hex and differs for different cards', () => {
    expect(fingerprint(card(1))).toMatch(/^[0-9a-f]{16}$/)
    expect(fingerprint(card(1))).not.toBe(fingerprint(card(2)))
  })
})

describe('decideOnStart', () => {
  const c = (n: number, t: number) => ({ card: card(n), updatedAt: t, hash: fingerprint(card(n)) })
  const meta = (n: number, t: number) => ({ updatedAt: t, hash: fingerprint(card(n)) })

  it('no cloud: push a local card, otherwise nothing', () => {
    expect(decideOnStart({ local: card(1), meta: null, cloud: null }).action).toBe('push')
    expect(decideOnStart({ local: null, meta: null, cloud: null }).action).toBe('none')
  })
  it('cloud equals local: nothing to do', () => {
    expect(decideOnStart({ local: card(1), meta: null, cloud: c(1, 5) }).action).toBe('none')
  })
  it('no local card (new device): pull', () => {
    const d = decideOnStart({ local: null, meta: null, cloud: c(1, 5) })
    expect(d.action).toBe('pull')
    expect(d.inject).toEqual(card(1))
  })
  it('local unchanged since last sync, cloud moved on: pull', () => {
    expect(decideOnStart({ local: card(1), meta: meta(1, 5), cloud: c(2, 9) }).action).toBe('pull')
  })
  it('local changed, cloud unchanged since last sync: push', () => {
    expect(decideOnStart({ local: card(3), meta: meta(1, 5), cloud: c(1, 5) }).action).toBe('push')
  })
  it('both changed: conflict — inject cloud, keep the local card for download', () => {
    const d = decideOnStart({ local: card(3), meta: meta(1, 5), cloud: c(2, 9) })
    expect(d.action).toBe('conflict')
    expect(d.inject).toEqual(card(2))
    expect(d.keepLocal).toEqual(card(3))
  })
  it('local exists but this browser never synced and cloud differs: conflict', () => {
    expect(decideOnStart({ local: card(3), meta: null, cloud: c(2, 9) }).action).toBe('conflict')
  })
})
