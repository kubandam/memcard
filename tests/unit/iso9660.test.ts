// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildPs1Iso, SECTOR } from '../../scripts/iso9660.mjs'

const text = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '')

describe('buildPs1Iso', () => {
  const cnf = new TextEncoder().encode('BOOT = cdrom:\\MAIN.EXE;1\r\n')
  const exe = new Uint8Array(3000).fill(0xab)
  const iso = buildPs1Iso('TEST', [
    { name: 'SYSTEM.CNF', data: cnf },
    { name: 'MAIN.EXE', data: exe },
  ])

  it('is a whole number of 2048-byte sectors with a PVD at sector 16', () => {
    expect(iso.length % SECTOR).toBe(0)
    const pvd = iso.subarray(16 * SECTOR, 17 * SECTOR)
    expect(pvd[0]).toBe(1)
    expect(text(pvd.subarray(1, 6))).toBe('CD001')
    expect(text(pvd.subarray(40, 72)).trim()).toBe('TEST')
    expect(iso[17 * SECTOR]).toBe(255) // terminator
  })

  it('names root entries with the ;1 version suffix pcsx_rearmed requires', () => {
    const rootExtent = new DataView(iso.buffer, iso.byteOffset).getUint32(16 * SECTOR + 156 + 2, true)
    const dir = iso.subarray(rootExtent * SECTOR, (rootExtent + 1) * SECTOR)
    const names: string[] = []
    const extents: number[] = []
    for (let i = 0; i < SECTOR && dir[i]; i += dir[i]!) {
      const len = dir[i + 32]!
      names.push(len === 1 && dir[i + 33]! < 2 ? `\\x0${dir[i + 33]}` : text(dir.subarray(i + 33, i + 33 + len)))
      extents.push(new DataView(dir.buffer, dir.byteOffset + i + 2).getUint32(0, true))
    }
    expect(names).toEqual(['\\x00', '\\x01', 'SYSTEM.CNF;1', 'MAIN.EXE;1'])
    const cnfExtent = extents[2]!
    expect(text(iso.subarray(cnfExtent * SECTOR, cnfExtent * SECTOR + cnf.length))).toBe('BOOT = cdrom:\\MAIN.EXE;1\r\n')
    const exeExtent = extents[3]!
    expect(iso.subarray(exeExtent * SECTOR, exeExtent * SECTOR + exe.length)).toEqual(exe)
  })

  it('rejects names that are not ISO level-1 8.3 uppercase', () => {
    expect(() => buildPs1Iso('X', [{ name: 'lower.exe', data: exe }])).toThrow(/8\.3/)
  })
})
