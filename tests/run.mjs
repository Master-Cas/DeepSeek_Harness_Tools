/**
 * Test runner: executes every `tests/*.test.mjs` in order, then the original
 * smoke test. Fails fast with the offending suite's error.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const dir = path.dirname(fileURLToPath(import.meta.url))
const suites = fs
  .readdirSync(dir)
  .filter((file) => file.endsWith('.test.mjs'))
  .sort()

let passed = 0
for (const suite of suites) {
  try {
    await import(pathToFileURL(path.join(dir, suite)).href)
    passed++
  } catch (error) {
    console.error(`FAIL ${suite}`)
    console.error(error)
    process.exit(1)
  }
}

try {
  await import(pathToFileURL(path.join(dir, 'smoke.mjs')).href)
} catch (error) {
  console.error('FAIL smoke.mjs')
  console.error(error)
  process.exit(1)
}

console.log(`\nAll test suites passed (${passed} locale suites + smoke).`)
