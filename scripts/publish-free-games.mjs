#!/usr/bin/env node
// Uploads every file and cover listed in content/free-games.json from a local folder to the
// memcard-free R2 bucket.  Usage: node scripts/publish-free-games.mjs <dir> --local|--remote
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const [dir, where] = process.argv.slice(2)
if (!dir || !['--local', '--remote'].includes(where)) {
  console.error('usage: publish-free-games.mjs <dir> --local|--remote')
  process.exit(1)
}
const games = JSON.parse(readFileSync('content/free-games.json', 'utf8'))
for (const g of games) {
  for (const name of [g.file, g.cover].filter(Boolean)) {
    const path = join(dir, name)
    if (!existsSync(path)) throw new Error(`missing ${path}`)
    if (name === g.file && statSync(path).size !== g.sizeBytes) throw new Error(`${name}: size differs from manifest`)
    execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `memcard-free/free/${name}`, '--file', path, where], { stdio: 'inherit' })
  }
}
console.log('published', games.length, 'games', where)
