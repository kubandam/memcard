#!/usr/bin/env node
// Downloads the EFF short wordlist #1 (CC BY 3.0 US) and writes app/assets/wordlist/eff-short-1.json.
import { writeFileSync } from 'node:fs'
const URL_ = 'https://www.eff.org/files/2016/09/08/eff_short_wordlist_1.txt'
const text = await (await fetch(URL_)).text()
const words = text.split('\n').map((l) => l.trim().split(/\s+/)[1]).filter(Boolean)
if (words.length !== 1296 || new Set(words).size !== 1296) throw new Error(`Unexpected wordlist size ${words.length}`)
writeFileSync('app/assets/wordlist/eff-short-1.json', JSON.stringify(words) + '\n')
console.log('wrote', words.length, 'words')
