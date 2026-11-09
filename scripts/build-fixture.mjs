#!/usr/bin/env node
// Builds tests/fixtures/controllers.iso from the MIT-licensed controller test program.
// See tests/fixtures/README.md for provenance.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPs1Iso } from './iso9660.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const exePath = join(root, 'tests/fixtures/example11_controllers.psexe')
const EXPECTED_SHA256 = '052ed0fcefd236042d5c0e8447b7484d0d05fc90bd39d12124c29d55a8c8d7ae'

const exe = readFileSync(exePath)
const sha = createHash('sha256').update(exe).digest('hex')
if (sha !== EXPECTED_SHA256) {
  console.error(`Unexpected fixture hash ${sha}; expected ${EXPECTED_SHA256}. Refusing to build.`)
  process.exit(1)
}

const cnf = new TextEncoder().encode('BOOT = cdrom:\\MAIN.EXE;1\r\nTCB = 4\r\nEVENT = 10\r\nSTACK = 801FFFF0\r\n')
const iso = buildPs1Iso('CONTROLLERS', [
  { name: 'SYSTEM.CNF', data: cnf },
  { name: 'MAIN.EXE', data: new Uint8Array(exe) },
])
const out = join(root, 'tests/fixtures/controllers.iso')
writeFileSync(out, iso)
console.log(`${out} (${iso.length} bytes)`)
