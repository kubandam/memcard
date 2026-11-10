import { formatBytes } from './format'

export interface Transfer {
  /** Plain bytes ready. */
  done: number
  total: number
  /** Of `done`, bytes that came over the network. */
  network: number
  /** performance.now() of the first report and of the latest one. */
  startedAt: number
  at: number
}

export interface TransferText {
  /** Everything so far came from this PC's cache. */
  cached: boolean
  percent: number
  done: string
  total: string
  speed: string
  eta: string
}

/** Human text for the boot screen: "120 MB / 324 MB · 8.1 MB/s · ~25 s". */
export function describeTransfer(x: Transfer): TransferText {
  const percent = Math.round((x.done / Math.max(1, x.total)) * 100)
  const seconds = Math.max(0.001, (x.at - x.startedAt) / 1000)
  const rate = x.network / seconds
  const left = x.total - x.done
  // The first second is mostly latency; only show speed and time left once they mean something.
  const settled = seconds >= 1 && rate > 0
  return {
    cached: x.network === 0 && x.done > 0,
    percent,
    done: formatBytes(x.done),
    total: formatBytes(x.total),
    speed: settled ? `${formatBytes(rate)}/s` : '…',
    eta: settled ? formatEta(left / rate) : '…',
  }
}

export function formatEta(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '…'
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} s`
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return s ? `~${m} min ${s} s` : `~${m} min`
}
