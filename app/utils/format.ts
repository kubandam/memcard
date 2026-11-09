const UNITS = ['B', 'KB', 'MB', 'GB', 'TB']

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  if (unit === 0) return `${Math.round(value)} B`
  const rounded = Math.round(value * 10) / 10
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} ${UNITS[unit]}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'} ago`
}

export function formatRelative(timestamp: number | null, now: number = Date.now()): string {
  if (timestamp === null) return 'never'
  const diff = Math.max(0, now - timestamp)
  if (diff < MINUTE) return 'just now'
  if (diff < HOUR) return plural(Math.floor(diff / MINUTE), 'minute')
  if (diff < DAY) return plural(Math.floor(diff / HOUR), 'hour')
  return plural(Math.floor(diff / DAY), 'day')
}
