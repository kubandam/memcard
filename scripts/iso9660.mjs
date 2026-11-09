/**
 * Minimal ISO 9660 writer for PS1 homebrew test discs: 2048-byte sectors, level-1 names
 * with the ";1" version suffix (pcsx_rearmed compares "SYSTEM.CNF;1" literally), files in
 * the root directory only. No licence sector is written — the core logs a warning and boots.
 */
export const SECTOR = 2048

const enc = new TextEncoder()

const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]
const be32 = (v) => le32(v).reverse()
const both32 = (v) => [...le32(v), ...be32(v)]
const both16 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 8) & 0xff, v & 0xff]
const sectors = (n) => Math.ceil(n / SECTOR)

function padTo(bytes, length, fill = 0) {
  const out = new Uint8Array(length).fill(fill)
  out.set(bytes.subarray(0, length))
  return out
}

function strField(text, length) {
  return padTo(enc.encode(text), length, 0x20)
}

function dirRecord(nameBytes, extent, size, flags) {
  const rec = [
    0, // length, patched below
    0, // extended attribute length
    ...both32(extent),
    ...both32(size),
    126, 0, 1, 0, 0, 0, 0, // 2026-01-01 00:00:00 UTC
    flags,
    0, 0, // unit size, interleave gap
    ...both16(1), // volume sequence number
    nameBytes.length,
    ...nameBytes,
  ]
  if (rec.length % 2) rec.push(0)
  rec[0] = rec.length
  return rec
}

const LEVEL1_NAME = /^[A-Z0-9_]{1,8}(\.[A-Z0-9_]{1,3})?$/

/**
 * @param {string} volumeId
 * @param {{ name: string, data: Uint8Array }[]} files  root-directory files, 8.3 uppercase names
 * @returns {Uint8Array}
 */
export function buildPs1Iso(volumeId, files) {
  for (const f of files) {
    if (!LEVEL1_NAME.test(f.name)) throw new Error(`"${f.name}" is not an ISO level-1 8.3 uppercase name`)
  }
  // Layout: 0–15 system area, 16 PVD, 17 terminator, 18 L path table, 19 M path table, 20 root dir, 21… files.
  const ROOT = 20
  let next = 21
  const records = [...dirRecord([0], ROOT, SECTOR, 2), ...dirRecord([1], ROOT, SECTOR, 2)]
  const placed = []
  for (const f of files) {
    records.push(...dirRecord(enc.encode(`${f.name};1`), next, f.data.length, 0))
    placed.push({ extent: next, data: f.data })
    next += Math.max(1, sectors(f.data.length))
  }
  if (records.length > SECTOR) throw new Error('Too many files for a one-sector root directory')
  const total = next

  const image = new Uint8Array(total * SECTOR)

  const pvd = new Uint8Array(SECTOR)
  pvd[0] = 1
  pvd.set(enc.encode('CD001'), 1)
  pvd[6] = 1
  pvd.set(strField('PLAYSTATION', 32), 8)
  pvd.set(strField(volumeId, 32), 40)
  pvd.set(both32(total), 80)
  pvd.set(both16(1), 120) // volume set size
  pvd.set(both16(1), 124) // volume sequence number
  pvd.set(both16(SECTOR), 128)
  pvd.set(both32(10), 132) // path table size
  pvd.set(le32(18), 140) // L path table
  pvd.set(be32(19), 148) // M path table
  pvd.set(dirRecord([0], ROOT, SECTOR, 2), 156)
  pvd.set(strField('', 128), 190) // volume set id
  pvd.set(strField('MEMCARD TEST FIXTURE', 128), 318) // publisher
  pvd.set(strField('', 128), 446)
  pvd.set(strField('', 128), 574)
  pvd.set(strField('', 37), 702)
  pvd.set(strField('', 37), 739)
  pvd.set(strField('', 37), 776)
  const date = enc.encode('2026010100000000')
  pvd.set(date, 813)
  pvd.set(date, 830)
  pvd.set(enc.encode('0000000000000000'), 847)
  pvd.set(enc.encode('0000000000000000'), 864)
  pvd[881] = 1
  image.set(pvd, 16 * SECTOR)

  const term = new Uint8Array(SECTOR)
  term[0] = 255
  term.set(enc.encode('CD001'), 1)
  term[6] = 1
  image.set(term, 17 * SECTOR)

  image.set([1, 0, ...le32(ROOT), 1, 0, 0, 0], 18 * SECTOR)
  image.set([1, 0, ...be32(ROOT), 0, 1, 0, 0], 19 * SECTOR)
  image.set(records, ROOT * SECTOR)
  for (const { extent, data } of placed) image.set(data, extent * SECTOR)
  return image
}
