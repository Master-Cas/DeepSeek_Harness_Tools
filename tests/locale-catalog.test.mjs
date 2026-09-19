/**
 * Catalog tests: importing the existing Spanish pack, normalization,
 * stats and credential redaction.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  catalogFromPlugin,
  catalogFromScan,
  catalogStats,
  loadCatalog,
  normalizeCatalog,
  writeCatalog,
} from '../tools/lib/catalog.mjs'
import { scanHarness } from '../tools/lib/harness-scan.mjs'
import { redact } from '../tools/lib/util.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Import the hand-maintained Spanish pack: every one of the 1643 keys survives.
const imported = catalogFromPlugin(path.join(root, 'plugins', 'deepseek-spanish', 'client.js'))
assert.equal(imported.locale, 'es')
assert.equal(imported.label, 'Español')
assert.equal(imported.fallback, 'en')
assert.equal(Object.keys(imported.namespaces).length, 48, 'imported namespace count')
let importedKeys = 0
for (const dictionary of Object.values(imported.namespaces)) importedKeys += Object.keys(dictionary).length
assert.equal(importedKeys, 1643, 'imported key count')
assert.equal(imported.namespaces['settings.locale']['language.title'], 'Idioma')
assert.equal(imported.namespaces.common.cancel, 'Cancelar')
assert.equal(imported.namespaces['open-in-app']['open.title'], 'Abrir el espacio de trabajo en {app}')

// normalizeCatalog accepts both the wrapped form and a bare namespace map.
const bare = normalizeCatalog({ alpha: { a: 'A' } })
assert.deepEqual(bare.namespaces, { alpha: { a: 'A' } })
const wrapped = normalizeCatalog({
  version: 1,
  locale: 'xx',
  label: 'Test',
  fallback: 'en',
  namespaces: { alpha: { a: 'A', b: 'B' } },
})
assert.equal(wrapped.locale, 'xx')
assert.equal(catalogStats(wrapped).keys, 2)

// catalogFromScan preserves namespace/key counts.
const harness = process.env.DSH_HARNESS ?? '/home/ubuntu/deepseek-harness'
if (fs.existsSync(path.join(harness, 'package.json'))) {
  const scan = await scanHarness(harness)
  const catalog = catalogFromScan(scan)
  assert.equal(catalogStats(catalog).namespaces, 48)
  assert.equal(catalogStats(catalog).keys, 1643)
}

// Round-trip a catalog through disk.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-locale-catalog-'))
const file = path.join(dir, 'xx.json')
writeCatalog(file, wrapped)
assert.deepEqual(loadCatalog(file).namespaces, wrapped.namespaces)
fs.rmSync(dir, { recursive: true, force: true })

// Credentials are never printable.
const savedKey = process.env.DEEPSEEK_API_KEY
const savedLocaleKey = process.env.DSH_LOCALE_API_KEY
process.env.DEEPSEEK_API_KEY = 'sk-supersecretvalue1234567890'
process.env.DSH_LOCALE_API_KEY = 'another-secret-value'
assert.equal(redact('using sk-supersecretvalue1234567890 now'), 'using [REDACTED] now')
assert.equal(redact('another-secret-value'), '[REDACTED]')
if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY
else process.env.DEEPSEEK_API_KEY = savedKey
if (savedLocaleKey === undefined) delete process.env.DSH_LOCALE_API_KEY
else process.env.DSH_LOCALE_API_KEY = savedLocaleKey

console.log('catalog tests: PASS')
