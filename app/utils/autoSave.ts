export interface Snapshot {
  state: Uint8Array
  screenshot: Uint8Array | null
}

export interface AutoSaveOptions {
  /** Current game state, or null when there is nothing to save (not running yet, core busy). */
  capture: () => Promise<Snapshot | null>
  /** Stores it (the cloud state slot); false when it could not be stored. */
  save: (s: Snapshot) => Promise<boolean>
  /** Skip timed saves while the game is paused or the tab is hidden. */
  idle?: () => boolean
  intervalMs?: number
  now?: () => number
}

/** Saves the running game to the cloud slot every few minutes, when the tab hides and before leaving. */
export function createAutoSave(opts: AutoSaveOptions) {
  const now = opts.now ?? Date.now
  const intervalMs = opts.intervalMs ?? 3 * 60_000
  let timer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<boolean> | null = null
  let lastSavedAt: number | null = null

  /** One save at a time; a second call while one runs shares its result. */
  function run(): Promise<boolean> {
    if (inFlight) return inFlight
    inFlight = (async () => {
      try {
        const snap = await opts.capture()
        if (!snap) return false
        const ok = await opts.save(snap)
        if (ok) lastSavedAt = now()
        return ok
      } catch {
        return false
      }
    })().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  /** Like run(), but gives up waiting after `ms` (the save itself may still finish). */
  function runWithin(ms: number): Promise<boolean> {
    return Promise.race([run(), new Promise<boolean>((r) => setTimeout(() => r(false), ms))])
  }

  function start() {
    if (timer) return
    timer = setInterval(() => {
      if (!opts.idle?.()) void run()
    }, intervalMs)
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return { start, stop, run, runWithin, lastSavedAt: () => lastSavedAt, active: () => timer !== null }
}
