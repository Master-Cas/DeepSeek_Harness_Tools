/**
 * Lightweight (`~/.dsh`) scanner tests.
 *
 * The fixtures are *compiled* `lib/client.js` bundles that reference the
 * Harness browser runtime and are therefore never executed. The suite proves:
 *
 *   - `scanHarness` autodetects `mode: "installed"` for `@deepseek-ai` trees,
 *     including the per-profile `profiles/<name>/node_modules` layout;
 *   - namespaces/dictionaries are recovered statically from `const NS`,
 *     `const en = { ... }`, `en = { ... }`, spreads, copies and template
 *     literals;
 *   - package entries may be symlinks or real directories;
 *   - discoverability is generic: a namespace invented at test time is found
 *     and no fixture name appears anywhere in the scanner sources.
 */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { detectHarnessMode } from '../tools/lib/harness-detect.mjs'
import { scanHarness } from '../tools/lib/harness-scan.mjs'
import { resolveHarness } from '../tools/lib/util.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const lightweight = path.join(root, 'tests', 'fixtures', 'lightweight')
const profiles = path.join(root, 'tests', 'fixtures', 'lightweight-profiles')
const sourceFixture = path.join(root, 'tests', 'fixtures', 'harness')
const scannerSources = ['harness-scan.mjs', 'harness-detect.mjs', 'installed-scan.mjs', 'static-js.mjs'].map(
  (file) => fs.readFileSync(path.join(root, 'tools', 'lib', file), 'utf8'),
)

// --- Autodetection --------------------------------------------------------

assert.deepEqual(
  detectHarnessMode(sourceFixture)?.mode,
  'source',
  'package.json + packages must be a source checkout',
)
assert.equal(detectHarnessMode(lightweight)?.mode, 'installed')
assert.equal(detectHarnessMode(path.join(lightweight, 'node_modules', '@deepseek-ai'))?.mode, 'installed')
assert.equal(detectHarnessMode(path.join(root, 'tools'))?.mode, undefined, 'unrelated dir is not a harness')

// --- Installed fixture ----------------------------------------------------

const fixture = await scanHarness(lightweight)
assert.equal(fixture.mode, 'installed')
assert.equal(fixture.root, lightweight)
assert.equal(fixture.harnessVersion, '3.1.4-fixture')
assert.equal(fixture.stats.namespaces, 3)
assert.equal(fixture.stats.keys, 8)
assert.equal(fixture.stats.placeholders, 4)
assert.equal(fixture.warnings.length, 0, `installed warnings: ${fixture.warnings.join('; ')}`)
assert.deepEqual(Object.keys(fixture.namespaces), ['compiled.one', 'compiled.three', 'compiled.two'])

// Bilingual constant namespace, shared spread base and comment stripping.
assert.equal(fixture.namespaces['compiled.one'].greet, 'Hello {name}')
assert.equal(fixture.namespaces['compiled.one']['shared.key'], 'Shared value')
assert.equal(fixture.namespaces['compiled.one']['deep.key'], 'Deep {n}')
assert.ok(!fixture.namespaces['ghost.one'], 'commented registration must be ignored')

// Aliased dictionary constants and an inline literal namespace.
assert.equal(fixture.namespaces['compiled.two'].title, 'Title')
assert.equal(fixture.namespaces['compiled.two'].count, '{n} items')

// One-locale-per-call tuple list.
assert.equal(fixture.namespaces['compiled.three'].bye, 'Bye {who}')
assert.equal(fixture.namespaces['compiled.three'].ok, 'OK')

for (const source of Object.values(fixture.sources)) {
  assert.ok(source.endsWith('lib/client.js'), `installed source should be a compiled bundle: ${source}`)
}

// --- Equivalent `profiles/<name>/node_modules` path -----------------------

const profileScan = await scanHarness(profiles)
assert.equal(profileScan.mode, 'installed')
assert.deepEqual(Object.keys(profileScan.namespaces), ['compiled.four'])
assert.equal(profileScan.namespaces['compiled.four'].base, 'Base')
assert.equal(profileScan.namespaces['compiled.four'].concat, 'AB')
assert.equal(profileScan.namespaces['compiled.four'].tpl, 'Hi world')

// --- Symlinks and no hardcoded namespace list -----------------------------

const tmp = fs.mkdtempSync(path.join(root, '.tmp-locale-installed-'))
try {
  const scope = path.join(tmp, 'node_modules', '@deepseek-ai')
  fs.mkdirSync(scope, { recursive: true })

  // A namespace invented at test time cannot be in any hardcoded list.
  const dynamicNamespace = `probe.dynamic.${process.pid}.${Date.now()}`
  const dynamicDir = path.join(scope, 'ui-dynamic')
  fs.mkdirSync(path.join(dynamicDir, 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(dynamicDir, 'lib', 'client.js'),
    `const NS = ${JSON.stringify(dynamicNamespace)};\n` +
      'const en = { "probe": "Probe {value}" };\n' +
      'function apply(ctx) { ctx.locale.register(NS, { en }); }\n' +
      'export { apply };\n',
  )

  // The one-locale-per-call form with an explicit `'en'` argument.
  const literalNamespace = `probe.literal.${process.pid}.${Date.now()}`
  const literalDir = path.join(scope, 'ui-literal')
  fs.mkdirSync(path.join(literalDir, 'lib'), { recursive: true })
  fs.writeFileSync(
    path.join(literalDir, 'lib', 'client.js'),
    `const NS = ${JSON.stringify(literalNamespace)};\n` +
      'function apply(ctx) { ctx.locale.register(NS, "en", { "literal.key": "Literal {x}" }); }\n' +
      'export { apply };\n',
  )

  // A second package reached through a symlink (pnpm/workspace layouts).
  const linkedSource = path.join(lightweight, 'node_modules', '@deepseek-ai', 'ui-compiled-one')
  fs.symlinkSync(linkedSource, path.join(scope, 'ui-linked'), 'dir')

  const scanned = await scanHarness(tmp)
  assert.equal(scanned.mode, 'installed')
  assert.deepEqual(
    Object.keys(scanned.namespaces),
    ['compiled.one', dynamicNamespace, literalNamespace].sort(),
  )
  assert.equal(scanned.namespaces[dynamicNamespace].probe, 'Probe {value}')
  assert.equal(scanned.namespaces[literalNamespace]['literal.key'], 'Literal {x}')
  assert.equal(scanned.namespaces['compiled.one'].greet, 'Hello {name}')

  // No fixture namespace string is baked into the scanner implementation.
  for (const source of scannerSources) {
    for (const name of [
      'compiled.one',
      'compiled.two',
      'compiled.three',
      'compiled.four',
      dynamicNamespace,
      literalNamespace,
    ]) {
      assert.ok(!source.includes(name), `scanner source must not hardcode "${name}"`)
    }
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true })
}

// --- resolveHarness: explicit/env before the ~/.dsh fallback --------------

assert.equal(resolveHarness(sourceFixture), sourceFixture, 'explicit source checkout')
assert.equal(resolveHarness(lightweight), lightweight, 'explicit installed root wins over nearby checkouts')

const previous = process.env.DSH_HARNESS
process.env.DSH_HARNESS = lightweight
try {
  assert.equal(resolveHarness(), lightweight, 'DSH_HARNESS installed root')
} finally {
  if (previous === undefined) delete process.env.DSH_HARNESS
  else process.env.DSH_HARNESS = previous
}

console.log('installed scanner tests: PASS')
